import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../logger';
import { configService } from './config';
import { snapclientInstanceService } from './snapclientInstances';
import { backupService, BackupComponent } from './backup';
import { jobService } from './jobs';
import { run, needsSudo } from '../platform/exec';
import type { RunOptions } from '../platform/exec';
import {
  control as systemdControl,
  activeState as systemdActiveState,
  logs as systemdLogs,
  daemonReload as systemdDaemonReload,
} from '../platform/systemd';
import * as apt from '../platform/apt';
import { installPrivilegedFile, readTextFile } from '../platform/files';

// Builds (e.g. shairport-sync's `run('bash', [scriptPath], ...)` below) can
// produce far more output than run()'s 10 MiB default maxBuffer, and can
// genuinely take several minutes to compile on a Raspberry Pi -- both
// generous on purpose (Task 12; formerly this exact { maxBuffer } shape was
// passed straight to child_process.exec() as EXEC_OPTS for the same reason).
const BUILD_RUN_OPTS: RunOptions = { maxBuffer: 50 * 1024 * 1024, timeoutMs: 20 * 60 * 1000 };

// Timeout for outbound network calls (GitHub API, NodeSource's repo GPG key,
// myMPD's OBS repo GPG key) made via native fetch() -- see getLatestGitHubRelease(),
// updateNodeJs(), and installMympd() below (Task 11, migrating off `curl`;
// updateNodeJs()'s fetch target updated by Task 17).
const FETCH_TIMEOUT_MS = 10_000;

export type PackageName = 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'node' | 'mpd' | 'mympd';

function normalizeVersion(raw: string | undefined | null): string {
  if (!raw) return 'unknown';
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  const m = trimmed.match(/v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i);
  if (!m) return 'unknown';
  return `v${m[1]}`;
}

/**
 * Maps an /etc/os-release (ID, VERSION_ID) to the myMPD openSUSE Build Service
 * (OBS) repository directory. Returns null for distros myMPD doesn't publish for.
 * Debian/Raspbian use the major version; Ubuntu uses the full VERSION_ID.
 * Raspberry Pi OS reports ID=debian, which maps to Debian_<major> (armhf/arm64
 * builds live there).
 */
export function mympdObsRepoDir(id: string, versionId: string): string | null {
  const norm = (id || '').trim().toLowerCase();
  const version = (versionId || '').trim();
  const major = version.split('.')[0];
  if (!major) return null;
  if (norm === 'debian') return `Debian_${major}`;
  if (norm === 'raspbian') return `Raspbian_${major}`;
  if (norm === 'ubuntu') return `xUbuntu_${version}`;
  return null;
}

/**
 * Picks the snap-ctrl release asset to download, replicating -- exactly,
 * asset-by-asset -- the embedded `python3 -c "import json,sys;..."`
 * one-liner `installSnapCtrl()` used to pipe the GitHub API response
 * through (Task 12). snap-ctrl releases ship pre-built frontend zips
 * (`dist.zip` / `dist-ha.zip`), each containing a top-level `dist/` folder
 * and no `package.json`. Preference order, matching the Python exactly:
 *   1. an asset literally named `dist.zip` (case-insensitive)
 *   2. else the first `.zip` asset whose name does NOT contain "ha"
 *      (case-insensitive) -- excludes the Home-Assistant-flavored build
 *   3. else the first `.zip` asset at all
 *   4. else `release.zipball_url` (GitHub's auto-generated full-source
 *      zip, when the release has no `.zip` asset at all)
 * Returns '' only if even `zipball_url` is missing from the release JSON
 * (installSnapCtrl() treats that as a hard error, same as the original).
 * Pure JSON/array manipulation -- python3 buys nothing here that
 * `.filter()`/`.find()` doesn't already do in-process.
 */
export function selectSnapCtrlDownloadUrl(release: any): string {
  const assets: any[] = Array.isArray(release?.assets) ? release.assets : [];
  const zipAssets = assets.filter(a => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.zip'));
  const exact = zipAssets.find(a => a.name.toLowerCase() === 'dist.zip');
  if (exact) return exact.browser_download_url;
  const nonHa = zipAssets.find(a => !a.name.toLowerCase().includes('ha'));
  if (nonHa) return nonHa.browser_download_url;
  if (zipAssets.length > 0) return zipAssets[0].browser_download_url;
  return release?.zipball_url || '';
}

// Task 27: this file's console.log/console.error call sites migrated to a
// pino child logger, prioritized per the task brief as one of the
// highest-value targets. The literal "[system]"/etc. text prefixes these
// messages used to carry are dropped -- that's now redundant with the
// structured `component: "system"` field every line from this logger
// already carries.
const log = logger.child({ component: 'system' });

export class SystemService {
  private distroCodename: string | null = null;
  private releaseCache: Record<string, { timestamp: number, data: any }> = {};
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // Installed packages and versions only change through install/update actions,
  // so cache them and let the dashboard poll cheaply (statuses stay live).
  private pkgCache: { timestamp: number; installed: any; versions: any; available: any } | null = null;
  private readonly PKG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  invalidatePackageCache(): void {
    this.pkgCache = null;
  }

  private async safeBackup(component: BackupComponent): Promise<string> {
    try {
      const result = await backupService.createPreUpdateBackup(component);
      if (result.path) {
        log.info(`Pre-${component} backup: ${result.path}`);
        return result.path;
      }
      log.info(`No files to back up for ${component}`);
      return '';
    } catch (err: any) {
      log.error({ err }, `Backup before ${component} failed`);
      return '';
    }
  }

  /**
   * `run('sudo', argv, opts)` when `needsSudo()`, `run(argv[0], argv.slice(1),
   * opts)` otherwise -- the same per-call sudo-split idiom every other
   * migrated service in this codebase uses (see e.g.
   * `services/pipeSources.ts`'s `removeServiceFile()`/`ensureRuntimeDir()`),
   * pulled into one shared helper here since Task 11 needed it at many call
   * sites across install/uninstall/update. Never string-concatenates `sudo`
   * into a binary name -- that was the exact "false sudo split" bug a
   * previous task caught (see this file's test suite for the exact-argv
   * assertions that guard against it recurring).
   *
   * The optional `opts` (added Task 12) forwards a `RunOptions` (e.g. a
   * longer `timeoutMs`/bigger `maxBuffer` for a slow build, or `env` for a
   * privileged call that needs an extra environment variable) straight
   * through to `run()` -- every pre-Task-12 call site omits it and keeps
   * run()'s defaults, unchanged.
   */
  private async runPrivileged(argv: string[], opts?: RunOptions) {
    return needsSudo() ? run('sudo', argv, opts) : run(argv[0], argv.slice(1), opts);
  }

  async installPackage(pkg: string): Promise<string> {
    this.invalidatePackageCache();
    await this.safeBackup(this.mapToComponent(pkg));
    if (pkg === 'shairport-sync') {
      return this.installShairportSync();
    }
    if (pkg === 'snapclient') {
      return this.updateSnapclientFromGitHub(false);
    }
    if (pkg === 'snapserver') {
      return this.updateSnapserverFromGitHub(false);
    }
    if (pkg === 'mpd') {
      return this.installMpd();
    }
    if (pkg === 'mympd') {
      return this.installMympd();
    }
    jobService.log('Updating package lists...');
    await apt.update();
    jobService.log(`Installing ${pkg} package...`);
    await apt.install([pkg]);
    const msg = `${pkg} installed successfully.`;
    jobService.log(msg);
    return msg;
  }

  private mapToComponent(pkg: string): BackupComponent {
    if (pkg === 'snapserver' || pkg === 'snapclient' || pkg === 'snap-ctrl') return pkg;
    if (pkg === 'shairport-sync' || pkg === 'mpd' || pkg === 'ffmpeg' || pkg === 'node') return pkg;
    return 'general';
  }

  private async installMpd(): Promise<string> {
    jobService.log('Updating package lists...');
    await apt.update();
    jobService.log('Installing mpd package...');
    await apt.install(['mpd']);
    // Original chain: `2>/dev/null || true` for each of these three steps
    // (mpd.socket may not exist/be masked on a fresh install -- that's fine,
    // not a real failure) -- mirrored here with `.catch(() => {})`.
    jobService.log('Stopping mpd.socket...');
    await systemdControl('mpd.socket', 'stop').catch(() => {});
    jobService.log('Disabling mpd.socket...');
    await systemdControl('mpd.socket', 'disable').catch(() => {});
    jobService.log('Unmasking mpd.service...');
    await systemdControl('mpd.service', 'unmask').catch(() => {});
    jobService.log('Enabling mpd.service...');
    await systemdControl('mpd.service', 'enable');
    jobService.log('Restarting mpd.service...');
    await systemdControl('mpd.service', 'restart');
    const msg = 'MPD installed and started successfully.';
    jobService.log(msg);
    return msg;
  }

  /**
   * gpg --dearmor binary-stdin handling (Task 11 -- see task-11-report.md
   * for the full writeup): `platform/exec.ts`'s `run()` always decodes a
   * child's stdout as a UTF-8 string (`execFile(..., { encoding: 'utf8' },
   * ...)`), which would corrupt the DEARMORED (binary OpenPGP) key bytes if
   * captured through it. The armored key TEXT itself is ASCII-safe (a
   * "-----BEGIN PGP PUBLIC KEY BLOCK-----" block), so it's fine as a plain
   * string, but gpg's *output* is not. This sidesteps run()'s stdout
   * capture entirely by telling gpg to write its binary output straight to
   * a file via `-o <path>` (a real gpg flag, not a shell feature) instead
   * of stdout, then reads that file back with a plain `fs.promises.readFile`
   * (no encoding argument -> returns a `Buffer`, never string-decoded) --
   * the binary bytes never pass through anything that could reinterpret
   * their encoding. Both the armored input and dearmored output live in a
   * fresh, unpredictable `fs.promises.mkdtemp` directory (same
   * symlink-race-hardening pattern as `platform/files.ts`'s
   * `installPrivilegedFile()`), always removed in a `finally`.
   */
  private async dearmorGpgKey(armoredKey: string): Promise<Buffer> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapmanager-mympd-key-'));
    try {
      const inFile = path.join(tmpDir, 'release.asc');
      const outFile = path.join(tmpDir, 'release.gpg');
      await fs.promises.writeFile(inFile, armoredKey, 'utf-8');
      await run('gpg', ['--dearmor', '--yes', '-o', outFile, inFile]);
      return await fs.promises.readFile(outFile);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async installMympd(): Promise<string> {
    const osRelease = await fs.promises.readFile('/etc/os-release', 'utf-8');
    const id = (osRelease.match(/^ID=(.*)$/m)?.[1] || '').replace(/"/g, '').trim();
    const versionId = (osRelease.match(/^VERSION_ID=(.*)$/m)?.[1] || '').replace(/"/g, '').trim();
    const repoDir = mympdObsRepoDir(id, versionId);
    if (!repoDir) {
      throw new Error(`Unsupported distro for automatic myMPD install (ID=${id}, VERSION_ID=${versionId}). See https://jcorporation.github.io/myMPD/#/010-installation`);
    }
    const baseUrl = `https://download.opensuse.org/repositories/home:/jcorporation/${repoDir}`;

    jobService.log('Updating package lists...');
    await apt.update();
    // Only `gpg` is installed here -- `curl` is no longer needed now that
    // the repo GPG key is fetched via native fetch() below (Task 11).
    jobService.log('Installing gpg...');
    await apt.install(['gpg']);
    jobService.log('Creating /etc/apt/keyrings...');
    await this.runPrivileged(['mkdir', '-p', '/etc/apt/keyrings']);

    jobService.log(`Downloading myMPD repository key from ${baseUrl}...`);
    const keyUrl = `${baseUrl}/Release.key`;
    const keyResponse = await fetch(keyUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!keyResponse.ok) {
      throw new Error(`Failed to download myMPD repo GPG key: HTTP ${keyResponse.status} for ${keyUrl}`);
    }
    const armoredKey = await keyResponse.text();
    const dearmoredKey = await this.dearmorGpgKey(armoredKey);
    jobService.log('Installing myMPD APT keyring...');
    await installPrivilegedFile('/etc/apt/keyrings/mympd.gpg', dearmoredKey, { mode: 0o644 });

    const repoLine = `deb [signed-by=/etc/apt/keyrings/mympd.gpg] ${baseUrl}/ /\n`;
    jobService.log('Adding myMPD APT repository...');
    await installPrivilegedFile('/etc/apt/sources.list.d/mympd.list', repoLine, { mode: 0o644 });

    jobService.log('Updating package lists...');
    await apt.update();
    jobService.log('Installing mympd package...');
    await apt.install(['mympd']);
    jobService.log('Enabling mympd.service...');
    await systemdControl('mympd.service', 'enable');
    jobService.log('Restarting mympd.service...');
    await systemdControl('mympd.service', 'restart');

    const msg = 'myMPD installed and started successfully.';
    jobService.log(msg);
    return msg;
  }

  async updatePackage(pkg: PackageName, clean: boolean = false): Promise<string> {
    this.invalidatePackageCache();
    if (pkg !== 'snap-ctrl') {
      await this.safeBackup(this.mapToComponent(pkg));
    }
    if (pkg === 'snap-ctrl') {
      return this.installSnapCtrl();
    }

    if (pkg === 'shairport-sync') {
      return this.installShairportSync();
    }

    if (pkg === 'snapserver') {
      return this.updateSnapserverFromGitHub(clean);
    }

    if (pkg === 'snapclient') {
      return this.updateSnapclientFromGitHub(clean);
    }

    jobService.log('Updating package lists...');
    await apt.update();
    jobService.log(`Upgrading ${pkg}...`);
    await apt.upgrade([pkg]);
    const msg = `${pkg} updated successfully.`;
    jobService.log(msg);
    return msg;
  }

  async uninstallPackage(pkg: string): Promise<string> {
    this.invalidatePackageCache();
    await this.safeBackup(this.mapToComponent(pkg));
    if (pkg === 'snapclient') {
      jobService.log('Stopping snapclient.service...');
      await systemdControl('snapclient.service', 'stop').catch(() => {});
      jobService.log('Disabling snapclient.service...');
      await systemdControl('snapclient.service', 'disable').catch(() => {});
      jobService.log('Purging snapclient package...');
      await this.runPrivileged(['dpkg', '--purge', 'snapclient']);
      const msg = 'snapclient removed successfully.';
      jobService.log(msg);
      return msg;
    }
    if (pkg === 'shairport-sync') {
      jobService.log('Stopping and disabling services...');
      await systemdControl('shairport-sync.service', 'stop').catch(() => {});
      await systemdControl('shairport-sync.service', 'disable').catch(() => {});
      await systemdControl('nqptp.service', 'stop').catch(() => {});
      await systemdControl('nqptp.service', 'disable').catch(() => {});
      jobService.log('Removing binaries and service files...');
      await this.runPrivileged(['rm', '-f', '/usr/local/bin/shairport-sync', '/usr/local/bin/nqptp']);
      await this.runPrivileged(['rm', '-f', '/etc/systemd/system/shairport-sync.service', '/etc/systemd/system/nqptp.service']);
      await systemdDaemonReload();
      const msg = 'Shairport-sync and nqptp removed successfully.';
      jobService.log(msg);
      return msg;
    }
    if (pkg === 'mpd') {
      jobService.log('Stopping mpd.socket...');
      await systemdControl('mpd.socket', 'stop').catch(() => {});
      jobService.log('Disabling mpd.socket...');
      await systemdControl('mpd.socket', 'disable').catch(() => {});
      jobService.log('Stopping mpd.service...');
      await systemdControl('mpd.service', 'stop').catch(() => {});
      jobService.log('Disabling mpd.service...');
      await systemdControl('mpd.service', 'disable').catch(() => {});
      jobService.log('Removing mpd package...');
      await apt.remove(['mpd']);
      const msg = 'MPD removed successfully.';
      jobService.log(msg);
      return msg;
    }
    if (pkg === 'mympd') {
      jobService.log('Stopping mympd.service...');
      await systemdControl('mympd.service', 'stop').catch(() => {});
      jobService.log('Disabling mympd.service...');
      await systemdControl('mympd.service', 'disable').catch(() => {});
      jobService.log('Removing mympd package...');
      await apt.remove(['mympd']);
      jobService.log('Removing myMPD APT repository files...');
      await this.runPrivileged(['rm', '-f', '/etc/apt/sources.list.d/mympd.list', '/etc/apt/keyrings/mympd.gpg']);
      const msg = 'myMPD removed successfully.';
      jobService.log(msg);
      return msg;
    }
    jobService.log(`Removing ${pkg} package...`);
    await apt.remove([pkg]);
    const msg = `${pkg} removed successfully.`;
    jobService.log(msg);
    return msg;
  }

  /**
   * `lsb_release -cs` first (now a plain argv `run()` -- no shell, no
   * `2>/dev/null`; `run()`'s stderr is simply never looked at here, which is
   * the same effect), falling back to parsing `/etc/os-release` directly.
   * The fallback used to be a `grep VERSION_CODENAME /etc/os-release | cut
   * -d= -f2` shell pipe -- Task 11 already established the "read the file
   * with fs.promises.readFile(), extract the field with a regex" pattern
   * for this exact file (see installMympd()'s ID=/VERSION_ID= parsing
   * above); this reuses that same pattern for VERSION_CODENAME= (Task 12).
   */
  private async getDistroCodename(): Promise<string> {
    if (this.distroCodename) return this.distroCodename;

    try {
      const { stdout } = await run('lsb_release', ['-cs']);
      const codename = stdout.trim();
      if (codename) {
        this.distroCodename = codename;
        return codename;
      }
    } catch (e) {}

    try {
      const osRelease = await fs.promises.readFile('/etc/os-release', 'utf-8');
      const codename = (osRelease.match(/^VERSION_CODENAME=(.*)$/m)?.[1] || '').replace(/"/g, '').trim();
      if (codename) {
        this.distroCodename = codename;
        return codename;
      }
    } catch (e) {}

    // Ultimate fallback for many debian-based systems if detection fails
    return 'bookworm';
  }

  private async updateSnapserverFromGitHub(clean: boolean = false): Promise<string> {
    const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
    const { stdout: arch } = await run('dpkg', ['--print-architecture']);
    const archTrimmed = arch.trim();
    const codename = await this.getDistroCodename();

    // Find the deb file for the current architecture and distro
    // Example: snapserver_0.35.0-1_amd64_bookworm.deb
    const asset = release.assets.find((a: any) =>
      a.name.startsWith('snapserver') &&
      a.name.endsWith('.deb') &&
      !a.name.includes('pipewire') && // Prefer standard version for now
      a.name.includes(archTrimmed) &&
      (a.name.includes(codename) || (codename === 'bookworm' && !a.name.includes('bullseye') && !a.name.includes('trixie'))) // Heuristic if codename match is literal
    );

    if (!asset) {
      // Fallback: search just by arch if codename specific not found
      const fallbackAsset = release.assets.find((a: any) =>
        a.name.startsWith('snapserver') && a.name.endsWith('.deb') && a.name.includes(archTrimmed)
      );

      if (!fallbackAsset) {
        throw new Error(`Could not find a .deb asset for architecture ${archTrimmed} (Distro: ${codename}) in Snapcast release ${release.tag_name}`);
      }
      return this.executeDebUpdate(fallbackAsset.browser_download_url, fallbackAsset.name, clean);
    }

    return this.executeDebUpdate(asset.browser_download_url, asset.name, clean);
  }

  private async updateSnapclientFromGitHub(clean: boolean = false): Promise<string> {
    const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
    const { stdout: arch } = await run('dpkg', ['--print-architecture']);
    const archTrimmed = arch.trim();
    const codename = await this.getDistroCodename();

    const asset = release.assets.find((a: any) =>
      a.name.startsWith('snapclient') &&
      a.name.endsWith('.deb') &&
      !a.name.includes('pipewire') &&
      a.name.includes(archTrimmed) &&
      (a.name.includes(codename) || (codename === 'bookworm' && !a.name.includes('bullseye') && !a.name.includes('trixie')))
    );

    if (!asset) {
      const fallbackAsset = release.assets.find((a: any) =>
        a.name.startsWith('snapclient') && a.name.endsWith('.deb') && a.name.includes(archTrimmed)
      );
      if (!fallbackAsset) {
        throw new Error(`Could not find a snapclient .deb asset for architecture ${archTrimmed} (Distro: ${codename}) in Snapcast release ${release.tag_name}`);
      }
      const result = await this.executeDebUpdate(fallbackAsset.browser_download_url, fallbackAsset.name, clean, 'snapclient');
      await this.postSnapclientInstall();
      return result;
    }

    const result = await this.executeDebUpdate(asset.browser_download_url, asset.name, clean, 'snapclient');
    await this.postSnapclientInstall();
    return result;
  }

  private async postSnapclientInstall(): Promise<void> {
    // Stop and disable the default package service — we manage our own instances
    await systemdControl('snapclient.service', 'stop').catch(() => {});
    await systemdControl('snapclient.service', 'disable').catch(() => {});
    // Disable the default package service; we manage per-instance services ourselves
    await snapclientInstanceService.postInstallSetup();
  }

  /**
   * `apt-get install -f -y ...` (the `dpkg -i` fallback), with
   * `DEBIAN_FRONTEND=noninteractive` set for the child process. Two
   * different mechanisms depending on whether `sudo` is in the way,
   * because they achieve the same original shell semantics differently:
   *
   * - `needsSudo()` true: the original shell command was literally `sudo
   *   DEBIAN_FRONTEND=noninteractive apt-get ...` -- `sudo` (not the
   *   shell) is what parses that leading `VAR=value` and applies it to the
   *   command it execs (see sudo(8): "environment variables to be set for
   *   the command may be passed on the command line"). Passing
   *   `'DEBIAN_FRONTEND=noninteractive'` as a literal argv element to
   *   `sudo` reproduces exactly that, argv-safe, no shell involved.
   * - `needsSudo()` false (already root): the original was a bare
   *   env-var-prefixed shell command (`DEBIAN_FRONTEND=noninteractive
   *   apt-get ...`), which only the shell's own env-prefix parsing
   *   handled. There is no shell here to do that, and `apt-get` itself
   *   doesn't parse a `VAR=value` argv element the way `sudo` does -- this
   *   is exactly the case that needs real child-process environment
   *   injection, which is why `platform/exec.ts`'s `RunOptions.env` was
   *   added in Task 12 (see that file for the full option and its own
   *   direct tests). `env` is only used on this branch.
   */
  private async aptGetInstallFix(): Promise<void> {
    const fixArgs = ['install', '-f', '-y', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold'];
    if (needsSudo()) {
      await run('sudo', ['DEBIAN_FRONTEND=noninteractive', 'apt-get', ...fixArgs]);
    } else {
      await run('apt-get', fixArgs, { env: { DEBIAN_FRONTEND: 'noninteractive' } });
    }
  }

  /**
   * The core `.deb` download+install pipeline shared by
   * `updateSnapserverFromGitHub()`/`updateSnapclientFromGitHub()`. Formerly
   * a single giant `&&`-chained shell command string executed via
   * `runCommand()`/`exec()`; broken here into individual `platform`-layer
   * calls in the exact same order, with the exact same failure-tolerance
   * (`.catch(() => {})` where the original had `|| true`) -- see
   * docs/superpowers/sdd/task-12-brief.md section 3 for the full mapping.
   *
   * The downloaded `.deb` now lives in a fresh, unpredictable
   * `fs.mkdtemp()` directory instead of the original's fixed, predictable
   * `/tmp/${fileName}` path -- closing the same symlink-race class of issue
   * design-spec finding #5 already closed for privileged file writes
   * (`platform/files.ts`'s `installPrivilegedFile()`).
   */
  private async executeDebUpdate(downloadUrl: string, fileName: string, clean: boolean = false, pkg: 'snapserver' | 'snapclient' = 'snapserver'): Promise<string> {
    log.info(`Downloading ${pkg} from ${downloadUrl}... (Clean: ${clean})`);

    if (clean) {
      jobService.log(`Cleaning up existing ${pkg} installation...`);
      if (pkg === 'snapclient') {
        await systemdControl('snapclient.service', 'stop').catch(() => {});
        await this.runPrivileged(['dpkg', '--purge', 'snapclient']).catch(() => {});
        await this.runPrivileged(['rm', '-f', '/etc/default/snapclient']);
      } else {
        await systemdControl('snapserver.service', 'stop').catch(() => {});
        await this.runPrivileged(['dpkg', '--purge', 'snapserver']).catch(() => {});
        await this.runPrivileged(['rm', '-rf', '/etc/snapserver.conf', '/etc/snapserver.conf.base', '/etc/snapserver.conf.d', '/var/lib/snapserver']);
      }
    }

    jobService.log('Updating package lists...');
    await apt.update();

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapmanager-deb-'));
    try {
      const debFile = path.join(tmpDir, fileName);
      jobService.log(`Downloading ${fileName}...`);
      await run('wget', ['-qO', debFile, downloadUrl], { timeoutMs: 5 * 60 * 1000 });

      jobService.log(`Installing ${fileName}...`);
      try {
        await this.runPrivileged(['dpkg', '-i', '--force-confdef', '--force-confold', debFile], { timeoutMs: 5 * 60 * 1000 });
      } catch (err) {
        // Original shell `||` fallback: dpkg -i can exit non-zero purely
        // because of missing dependencies, which `apt-get install -f`
        // resolves. Translated to a real try/catch, exactly matching the
        // original's "any real failure of THIS step, including the
        // fallback itself, aborts the whole update" semantic (nothing
        // here is swallowed).
        jobService.log('dpkg reported missing dependencies, resolving via apt-get install -f...');
        await this.aptGetInstallFix();
      }
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }

    jobService.log('Running post-install steps...');
    if (pkg === 'snapclient') {
      await systemdDaemonReload();
      await systemdControl('snapclient.service', 'restart');
    } else {
      await this.runPrivileged(['mkdir', '-p', '/var/lib/snapserver']);
      await this.runPrivileged(['chown', '-R', 'snapserver:snapserver', '/var/lib/snapserver']);
      await this.runPrivileged(['usermod', '-d', '/var/lib/snapserver', 'snapserver']).catch(() => {});
      await systemdDaemonReload();
      await systemdControl('snapserver.service', 'restart');
    }

    const msg = `${pkg} updated successfully.`;
    jobService.log(msg);
    return msg;
  }

  /**
   * Replaces the old `fetch(setup_<major>.x script) | sudo -E bash -`
   * pattern (Task 17 -- see task-17-brief.md and SECURITY.md's validation
   * checklist item 14) with NodeSource's own APT-repo method, mirroring
   * `installMympd()`'s already-shipped architecture exactly: native
   * `fetch()` for the GPG key, `dearmorGpgKey()` (reused directly, not
   * duplicated), `installPrivilegedFile()` for the keyring + APT
   * source-list files, `apt.update()` + `apt.install()`. The old pattern
   * piped a remotely-fetched script into a general-purpose `bash`
   * invocation, which Task 16's `sudoers.d/snapcast-manager` deliberately
   * does not grant (a general-purpose shell wildcard would defeat the
   * whole point of that file) -- this closes that gap with ZERO new
   * sudoers surface: every primitive used below (`gpg`, `mkdir`,
   * `installPrivilegedFile`'s `cp`/`chmod`, `apt-get`) is already granted.
   *
   * NodeSource's current documented method (replicated here without the
   * shell script): a GPG keyring dearmored from
   * `https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key` into
   * `/etc/apt/keyrings/nodesource.gpg`, plus a single distro-agnostic
   * `nodistro` APT source per major version pointing at
   * `https://deb.nodesource.com/node_<major>.x`. Unlike `installMympd()`
   * (which needs two `apt.update()` calls -- one to install `gpg` before
   * this repo exists, one after adding it), only ONE `apt.update()` is
   * needed here, right before installing `nodejs`, since there is nothing
   * else this function needs from `apt-get` before the new repo is added.
   */
  async updateNodeJs(version: string = '22'): Promise<string> {
    if (!/^\d{1,2}$/.test(version)) {
      throw new Error('Invalid Node.js major version');
    }
    this.invalidatePackageCache();
    log.info(`Updating Node.js to version ${version}...`);

    // Only `gpg` is installed here -- `updateNodeJs()` can be triggered
    // independently of installMympd() (in either order), so it cannot
    // assume `gpg` is already present on the host.
    jobService.log('Installing gpg...');
    await apt.install(['gpg']);

    const keyUrl = 'https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key';
    jobService.log(`Downloading NodeSource repository key from ${keyUrl}...`);
    const keyResponse = await fetch(keyUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!keyResponse.ok) {
      throw new Error(`Failed to download NodeSource repo GPG key: HTTP ${keyResponse.status} for ${keyUrl}`);
    }
    const armoredKey = await keyResponse.text();
    const dearmoredKey = await this.dearmorGpgKey(armoredKey);

    jobService.log('Creating /etc/apt/keyrings...');
    await this.runPrivileged(['mkdir', '-p', '/etc/apt/keyrings']);

    jobService.log('Installing NodeSource APT keyring...');
    await installPrivilegedFile('/etc/apt/keyrings/nodesource.gpg', dearmoredKey, { mode: 0o644 });

    const repoLine = `deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${version}.x nodistro main\n`;
    jobService.log('Adding NodeSource APT repository...');
    await installPrivilegedFile('/etc/apt/sources.list.d/nodesource.list', repoLine, { mode: 0o644 });

    jobService.log('Updating package lists...');
    await apt.update();
    jobService.log('Installing nodejs package...');
    await apt.install(['nodejs']);

    const msg = `Node.js updated to version ${version}.x`;
    jobService.log(msg);
    return msg;
  }

  async isInstalled(pkg: string): Promise<boolean> {
    try {
      if (pkg === 'snap-ctrl') {
        // Not an apt package -- checks that the install directory exists
        // and is non-empty. `fs.readdir` instead of shelling out to
        // `[ -d ... ] && [ "$(ls -A ...)" ]` (Task 11).
        try {
          const entries = await fs.promises.readdir('/usr/share/snapserver/snap-ctrl');
          return entries.length > 0;
        } catch {
          return false;
        }
      }
      if (pkg === 'shairport-sync') {
        // Not an apt package (built from source) -- checks the fixed
        // install path first, then falls back to a PATH lookup via the
        // real `which` binary (argv-based, no shell builtin needed to
        // replace the original `command -v shairport-sync`).
        try {
          await fs.promises.access('/usr/local/bin/shairport-sync');
          return true;
        } catch {
          try {
            await run('which', ['shairport-sync']);
            return true;
          } catch {
            return false;
          }
        }
      }
      if (pkg === 'node') {
        // Not an apt package on this host (installed via NodeSource) -- a
        // real argv-based invocation, not an apt lookup.
        await run('node', ['-v']);
        return true;
      }
      // Every remaining PackageName value is a real apt package --
      // platform/apt.ts's isInstalled() already implements exactly this
      // `dpkg -s <pkg>` check (Task 5); reuse it directly instead of
      // reimplementing it here (Task 11).
      return await apt.isInstalled(pkg);
    } catch (error) {
      return false;
    }
  }

  async getServiceStatus(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'mpd' | 'mympd'): Promise<string> {
    // Thin wrapper: platform/systemd.ts's activeState() already implements
    // the exact "systemctl is-active exits non-zero for inactive/failed --
    // that's the normal result, not a failure" handling this used to do
    // inline (Task 11).
    return systemdActiveState(`${service}.service`);
  }

  async getMympdInfo(): Promise<{ installed: boolean; running: boolean; port: number }> {
    const installed = await this.isInstalled('mympd');
    const running = installed ? (await this.getServiceStatus('mympd')) === 'active' : false;
    let port = 8080;
    try {
      // /var/lib/mympd/config/http_port is a plain text file -- reading it
      // directly is pure overhead-free file I/O, no process execution
      // needed at all (Task 11, same "drop cat" pattern as installMympd()'s
      // /etc/os-release read).
      const raw = await fs.promises.readFile('/var/lib/mympd/config/http_port', 'utf-8');
      const parsed = parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    } catch (e) { /* keep default 8080 */ }
    return { installed, running, port };
  }

  async getServiceLogs(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'snapmanager' | 'librespot' | 'mpd' | 'mympd'): Promise<string> {
    try {
      // platform/systemd.ts's logs() already applies sudo internally via
      // needsSudo() (mirrors journalctl()'s own gating) -- the old
      // sudo-then-fallback-without-sudo retry was redundant and is dropped
      // here, same resolution Task 8 used for snapclientInstances.ts
      // (Task 11).
      return await systemdLogs(`${service}.service`, 100);
    } catch (error: any) {
      log.error({ err: error }, `getServiceLogs failed for ${service}`);
      return `Failed to retrieve logs:\n${error.message || error}`;
    }
  }

  /**
   * Runs `bin args`, combining stdout+stderr (mirrors the original
   * commands' `2>&1` -- some of these tools print their version banner to
   * stderr) and returning the combined text -- replaces the shell `| head
   * -n 1` pipe with in-process line extraction in getPackageVersion() below
   * (Task 11, same "run the full command, filter in JS" pattern used for
   * getLatestAvailableVersion()'s apt-cache policy replacement).
   */
  private async firstLineOf(bin: string, args: string[]): Promise<string> {
    const { stdout, stderr } = await run(bin, args);
    return `${stdout}${stderr}`;
  }

  async getPackageVersion(pkg: PackageName): Promise<string> {
    try {
      let output = '';
      switch (pkg) {
        case 'snapserver':
          output = await this.firstLineOf('snapserver', ['--version']);
          break;
        case 'snapclient':
          output = await this.firstLineOf('snapclient', ['--version']);
          break;
        case 'ffmpeg':
          output = await this.firstLineOf('ffmpeg', ['-version']);
          break;
        case 'shairport-sync': {
          const hasLocalBinary = await fs.promises.access('/usr/local/bin/shairport-sync').then(() => true).catch(() => false);
          output = hasLocalBinary
            ? await this.firstLineOf('/usr/local/bin/shairport-sync', ['-V'])
            : await this.firstLineOf('shairport-sync', ['-V']);
          break;
        }
        case 'snap-ctrl': {
          // Preferred: the release tag we record at install time (current
          // releases are pre-built dist zips with no package.json).
          const marker = await readTextFile('/usr/share/snapserver/snap-ctrl/.snap-ctrl-version').catch(() => '');
          if (marker.trim()) return normalizeVersion(marker);
          // Fallback for older installs that shipped a package.json.
          const pkgJson = await readTextFile('/usr/share/snapserver/snap-ctrl/package.json').catch(() => '');
          const match = pkgJson.match(/"version"\s*:\s*"([^"]+)"/);
          return normalizeVersion(match?.[1]);
        }
        case 'node':
          output = await this.firstLineOf('node', ['-v']);
          break;
        case 'mpd':
          output = await this.firstLineOf('mpd', ['--version']);
          break;
        case 'mympd':
          output = await this.firstLineOf('mympd', ['--version']);
          break;
      }
      // Clean up version string (e.g. "snapserver v0.26.0" -> "v0.26.0")
      const firstLine = output.split('\n')[0].trim();
      const match = firstLine.match(/v?\d+\.\d+\.\d+/);
      return match ? match[0] : firstLine;
    } catch (error) {
      return 'unknown';
    }
  }

  async getLatestAvailableVersion(pkg: PackageName): Promise<string> {
    try {
      if (pkg === 'snap-ctrl') {
        const release = await this.getLatestGitHubRelease('NaturalDevCR', 'snap-ctrl');
        return normalizeVersion(release.tag_name);
      }

      if (pkg === 'snapserver' || pkg === 'snapclient') {
        const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
        return release.tag_name;
      }

      if (pkg === 'shairport-sync') {
        const release = await this.getLatestGitHubRelease('mikebrady', 'shairport-sync');
        return release.tag_name;
      }

      if (pkg === 'mympd') {
        const release = await this.getLatestGitHubRelease('jcorporation', 'myMPD');
        return normalizeVersion(release.tag_name);
      }

      if (pkg === 'node') {
        // We follow the nodesource LTS line used by the installer
        return 'v22.x (Latest)';
      }

      // `apt-cache policy <pkg>` is run for its FULL output (no shell pipe)
      // and the "Candidate:" line is parsed in JS instead of `grep Candidate
      // | awk '{print $2}'` (Task 11). Real `apt-cache policy` output looks
      // like:
      //   mpd:
      //     Installed: 0.23.5-1
      //     Candidate: 0.23.5-1
      //     Version table:
      //    *** 0.23.5-1 500
      //           500 http://deb.debian.org/debian bookworm/main amd64 Packages
      // -- when no candidate is available, "Candidate:" is followed by the
      // literal token "(none)".
      const { stdout } = await run('apt-cache', ['policy', pkg]);
      const match = stdout.match(/^\s*Candidate:\s*(\S+)/m);
      const version = match?.[1];
      if (!version || version === '(none)') return 'unknown';
      return version;
    } catch (error) {
      log.error({ err: error }, `Error checking latest version for ${pkg}`);
      return 'unknown';
    }
  }

  private async getLatestGitHubRelease(owner: string, repo: string): Promise<any> {
    const cacheKey = `${owner}/${repo}`;
    const now = Date.now();
    if (this.releaseCache[cacheKey] && now - this.releaseCache[cacheKey].timestamp < this.CACHE_TTL) {
      return this.releaseCache[cacheKey].data;
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    // Native fetch() (Node 22 builtin) instead of shelling out to `curl` --
    // eliminates both the shell-out and the dependency on `curl` being
    // installed, for what's just an HTTP GET (Task 11). Mirrors
    // server/src/utils/snapcastRpc.ts's existing native-fetch() usage in
    // this codebase.
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status} for ${apiUrl}`);
    }
    const release = await response.json();
    if (!release.tag_name) {
      throw new Error(`Invalid response from GitHub API for ${owner}/${repo}`);
    }

    this.releaseCache[cacheKey] = { timestamp: now, data: release };
    return release;
  }

  async getDashboardMetrics(): Promise<any> {
    const packages: PackageName[] = ['snapserver', 'snapclient', 'ffmpeg', 'shairport-sync', 'snap-ctrl', 'node', 'mpd', 'mympd'];
    const services = ['snapserver', 'snapclient', 'shairport-sync', 'mpd', 'mympd'] as const;

    const statusPromise = Promise.all(
      services.map(svc => this.getServiceStatus(svc).then(res => ({ svc, val: res })))
    );

    let pkgData = this.pkgCache && Date.now() - this.pkgCache.timestamp < this.PKG_CACHE_TTL
      ? this.pkgCache
      : null;

    if (!pkgData) {
      const [installedResults, versionResults, availableResults] = await Promise.all([
        Promise.all(packages.map(pkg => this.isInstalled(pkg).then(res => ({ pkg, val: res })))),
        Promise.all(packages.map(pkg => this.getPackageVersion(pkg).then(res => ({ pkg, val: res })))),
        Promise.all(packages.map(pkg => this.getLatestAvailableVersion(pkg).then(res => ({ pkg, val: res })))),
      ]);
      pkgData = {
        timestamp: Date.now(),
        installed: Object.fromEntries(installedResults.map(r => [r.pkg, r.val])),
        versions: Object.fromEntries(versionResults.map(r => [r.pkg, r.val])),
        available: Object.fromEntries(availableResults.map(r => [r.pkg, r.val])),
      };
      this.pkgCache = pkgData;
    }

    const statusResults = await statusPromise;

    return {
      installed: pkgData.installed,
      versions: pkgData.versions,
      available: pkgData.available,
      statuses: Object.fromEntries(statusResults.map(r => [r.svc, r.val]))
    };
  }

  async restartService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd' | 'mympd'): Promise<string> {
      await systemdControl(`${service}.service`, 'restart');
      return `${service} restarted`;
  }

  async startService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd' | 'mympd'): Promise<string> {
      await systemdControl(`${service}.service`, 'start');
      return `${service} started`;
  }

  async stopService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd' | 'mympd'): Promise<string> {
      await systemdControl(`${service}.service`, 'stop');
      return `${service} stopped`;
  }

  async enableService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd' | 'mympd'): Promise<string> {
      await systemdControl(`${service}.service`, 'enable');
      return `${service} enabled`;
  }

  async disableService(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'librespot' | 'mpd' | 'mympd'): Promise<string> {
      await systemdControl(`${service}.service`, 'disable');
      return `${service} disabled`;
  }

  /**
   * The full build logic (apt build-deps, removing legacy installs, `git
   * clone`+`autoreconf`+`configure`+`make -j$(nproc)`+`make install` for
   * both `nqptp` and `shairport-sync`, `useradd`/`groupadd`, systemd
   * enable/restart) now lives in the static, versioned, shellcheck-able
   * `server/scripts/install-shairport-sync.sh` -- this function is a thin
   * wrapper that just runs it via `run('bash', [scriptPath], ...)` (a plain
   * argv invocation, never a runtime-built shell string) and logs progress
   * around it.
   *
   * Privilege handling (fixed post-Task-12 review, see task-12-report.md's
   * "Fix report" section): unlike this file's other multi-step privileged
   * operations, this call does NOT go through `runPrivileged()` -- the
   * script itself is invoked as whatever user the Node process runs as,
   * NOT wrapped in `sudo` as a whole. That's deliberate: the script
   * compiles freshly-cloned, unpinned third-party source
   * (`autoreconf`/`./configure`/`make`), which can execute arbitrary shell
   * via Makefile rules, `config.guess`/`config.sub`, or autotools macros --
   * running that phase as root would be the highest-risk phase to
   * escalate. Instead, `needsSudo()` is computed here in Node (exactly as
   * `runPrivileged()` does internally) and passed into the script as the
   * `SNAPMGR_SUDO` environment variable ("1" or "0"); the script uses it to
   * prefix only its own individual privileged lines (apt-get, systemctl,
   * `make install`, useradd/groupadd, the legacy-install cleanup) with its
   * own `$SUDO`, leaving the build/compile phase unescalated -- restoring
   * the ORIGINAL (pre-Task-12) TypeScript implementation's per-line
   * privilege separation (`${this.SUDO}apt-get ...` etc.), which Task 12
   * had collapsed into escalating the whole script at once. See the
   * script's own header comment for the full mirror of this reasoning.
   *
   * `BUILD_RUN_OPTS`: a 50 MiB maxBuffer (this compiles two C projects with
   * verbose `autoreconf`/`make` output) and a 20-minute timeout (a full
   * from-source build of shairport-sync + nqptp, including their build
   * dependencies, can genuinely take several minutes on a Raspberry Pi --
   * `platform/apt.ts`'s own `INSTALL_TIMEOUT_MS` (10 minutes, for a plain
   * `apt-get install`) was the closest existing precedent; this is longer
   * because it also compiles from source, not just installs prebuilt
   * packages).
   *
   * Genuinely untestable in this environment without a real Debian host
   * with the full build toolchain installed -- see task-12-report.md.
   */
  async installShairportSync(): Promise<string> {
      log.info('Installing shairport-sync and nqptp from source... (AirPlay 2)');
      const scriptPath = path.join(__dirname, '../../scripts/install-shairport-sync.sh');
      jobService.log('Installing build dependencies and compiling shairport-sync + nqptp from source (this can take several minutes on a Raspberry Pi)...');
      await run('bash', [scriptPath], {
        ...BUILD_RUN_OPTS,
        env: { SNAPMGR_SUDO: needsSudo() ? '1' : '0' },
      });
      const msg = 'Shairport-sync and nqptp installed successfully.';
      jobService.log(msg);
      return msg;
  }

  /**
   * `find <dir> -type f -name index.html [-path <dist-glob>] -print -quit`
   * (the dist-glob restricts matches to a path with a "dist" directory
   * segment) -- argv-safe: `-path`'s glob pattern is `find`'s OWN flag syntax,
   * interpreted by `find` itself, not shell-expanded (no shell is
   * involved at all here, so there is nothing to expand it prematurely).
   * `find` exits 0 with empty stdout when nothing matches -- never throws
   * just because the search came up empty, mirroring the original
   * `$(find ... -print -quit)` capturing an empty string in that case.
   */
  private async findSnapCtrlIndex(extractDir: string, requireDistPath: boolean): Promise<string | null> {
    const args = requireDistPath
      ? [extractDir, '-type', 'f', '-name', 'index.html', '-path', '*/dist/*', '-print', '-quit']
      : [extractDir, '-type', 'f', '-name', 'index.html', '-print', '-quit'];
    const { stdout } = await run('find', args);
    const found = stdout.trim();
    return found.length > 0 ? found : null;
  }

  /**
   * Downloads and installs the latest snap-ctrl frontend release. Formerly
   * a single shell script that curled the GitHub API, piped the JSON
   * through embedded `python3 -c "..."` one-liners to extract the download
   * URL and tag, downloaded with `wget --no-check-certificate` (TLS
   * validation DISABLED -- design-spec finding #6), and used shell globbing
   * (`${installPath}/* ${installPath}/.[!.]*`) to empty the install
   * directory. Migrated here (Task 12) to:
   *   - reuse `getLatestGitHubRelease()` (Task 11, already used by
   *     `getLatestAvailableVersion('snap-ctrl')`) instead of a separate
   *     curl+python3 pipeline, with `selectSnapCtrlDownloadUrl()` above
   *     replicating the Python's exact asset-selection logic in TypeScript;
   *   - drop `--no-check-certificate` entirely -- `wget` now validates TLS
   *     certificates normally; there is no comment or history anywhere in
   *     this codebase indicating a real-world need for it, so it is removed
   *     outright rather than preserved "just in case" (flagged as a
   *     resolved concern in task-12-report.md, not silently kept);
   *   - add a minimal post-download size check (non-zero) -- NOT full
   *     artifact signature/hash verification, which design-spec finding #6
   *     will eventually want but is out of scope here (see the report);
   *   - move both the download and extraction directories off the
   *     predictable, fixed `/tmp/snap-ctrl-download` / `/tmp/snap-ctrl-extract`
   *     paths onto fresh `fs.mkdtemp()` directories (same finding-#5
   *     symlink-race class `executeDebUpdate()`'s `.deb` download closes
   *     above);
   *   - replace the `${installPath}/* ${installPath}/.[!.]*` shell-glob
   *     empty-the-directory trick with a full `rm -rf` + `mkdir -p`
   *     (semantically identical -- empties the directory entirely -- with
   *     no shell glob involved), sudo-gated via `runPrivileged()` since
   *     `/usr/share/snapserver/snap-ctrl` is root-owned and this process
   *     cannot write there directly;
   *   - replace the `printf '%s' "$TAG" | sudo tee ...` pipe (itself only
   *     existing to get a sudo-privileged file write) with
   *     `platform/files.ts`'s `installPrivilegedFile()` directly, which is
   *     exactly what that function exists for.
   */
  async installSnapCtrl(): Promise<string> {
      this.invalidatePackageCache();
      await this.safeBackup('snap-ctrl');
      const installPath = '/usr/share/snapserver/snap-ctrl';
      const docRootPath = path.join(installPath, 'dist');

      log.info('Installing snap-ctrl...');

      jobService.log('Fetching latest snap-ctrl release metadata...');
      const release = await this.getLatestGitHubRelease('NaturalDevCR', 'snap-ctrl');
      const tag = release.tag_name || '';
      const downloadUrl = selectSnapCtrlDownloadUrl(release);
      if (!downloadUrl) {
        throw new Error('Could not find a download URL for the latest snap-ctrl release');
      }

      const downloadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapmanager-snapctrl-dl-'));
      const extractDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapmanager-snapctrl-extract-'));
      try {
        const zipPath = path.join(downloadDir, 'snap-ctrl.zip');
        jobService.log(`Downloading snap-ctrl ${tag}...`);
        await run('wget', ['-qO', zipPath, downloadUrl], { timeoutMs: 5 * 60 * 1000 });

        // Minimal sanity check: did we actually get a real file, not a
        // truncated/empty response? NOT full artifact verification -- see
        // this method's doc comment and task-12-report.md.
        const stat = await fs.promises.stat(zipPath);
        if (stat.size === 0) {
          throw new Error('Downloaded snap-ctrl archive is empty');
        }

        jobService.log('Extracting snap-ctrl archive...');
        await run('unzip', ['-qo', zipPath, '-d', extractDir]);

        jobService.log('Locating built interface...');
        const index = (await this.findSnapCtrlIndex(extractDir, true)) ?? (await this.findSnapCtrlIndex(extractDir, false));
        if (!index) {
          throw new Error('No built index.html found in snap-ctrl archive');
        }
        const distDir = path.dirname(index);

        jobService.log(`Installing snap-ctrl to ${installPath}...`);
        await this.runPrivileged(['rm', '-rf', installPath]);
        await this.runPrivileged(['mkdir', '-p', docRootPath]);
        await this.runPrivileged(['cp', '-rT', distDir, docRootPath]);

        jobService.log('Recording installed version...');
        await installPrivilegedFile(path.join(installPath, '.snap-ctrl-version'), tag);
      } finally {
        await fs.promises.rm(downloadDir, { recursive: true, force: true });
        await fs.promises.rm(extractDir, { recursive: true, force: true });
      }

      const result = 'snap-ctrl installed successfully.';
      jobService.log(result);

      try {
          await configService.setSnapserverDocRoot(docRootPath);
          await this.restartService('snapserver');
      } catch (err) {
          log.error({ err }, 'Failed to update snapserver config for snap-ctrl');
      }

      return result;
  }

}

export const systemService = new SystemService();
