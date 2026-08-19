import { exec } from 'child_process';
import util from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { configService } from './config';
import { snapclientInstanceService } from './snapclientInstances';
import { backupService, BackupComponent } from './backup';
import { jobService } from './jobs';
import { run, needsSudo } from '../platform/exec';
import {
  control as systemdControl,
  activeState as systemdActiveState,
  logs as systemdLogs,
  daemonReload as systemdDaemonReload,
} from '../platform/systemd';
import * as apt from '../platform/apt';
import { installPrivilegedFile, readTextFile } from '../platform/files';

const execAsync = util.promisify(exec);

// Builds (e.g. shairport-sync) produce far more than the 1 MB default maxBuffer
const EXEC_OPTS = { maxBuffer: 50 * 1024 * 1024 };

// Timeout for outbound network calls (GitHub API, NodeSource setup script,
// myMPD's OBS repo GPG key) made via native fetch() -- see getLatestGitHubRelease(),
// updateNodeJs(), and installMympd() below (Task 11, migrating off `curl`).
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

  /**
   * Returns 'sudo ' when not root, or '' when already root (e.g. on bare
   * Debian). Still used by the Task-12 GitHub-release download/build/install
   * pipelines below (updateSnapserverFromGitHub, updateSnapclientFromGitHub,
   * executeDebUpdate, installShairportSync, installSnapCtrl,
   * getDistroCodename) and by runCommand()/execAsync -- all explicitly out
   * of scope for Task 11 (see docs/superpowers/sdd/task-11-brief.md), left
   * completely untouched here.
   */
  private get SUDO(): string {
    return (process as any).getuid?.() === 0 ? '' : 'sudo ';
  }

  private async runCommand(command: string): Promise<string> {
    try {
      console.log(`Executing: ${command}`);
      jobService.log(`$ ${command.trim().split('\n')[0]}`);
      const { stdout, stderr } = await execAsync(command, EXEC_OPTS);
      if (stderr) console.warn(`StdErr: ${stderr}`);
      const tail = stdout.trim().split('\n').slice(-10);
      for (const line of tail) jobService.log(line);
      return stdout;
    } catch (error) {
      console.error(`Error executing ${command}:`, error);
      jobService.log(`ERROR: ${(error as any)?.message || error}`);
      throw error;
    }
  }

  private async safeBackup(component: BackupComponent): Promise<string> {
    try {
      const result = await backupService.createPreUpdateBackup(component);
      if (result.path) {
        console.log(`[system] Pre-${component} backup: ${result.path}`);
        return result.path;
      }
      console.log(`[system] No files to back up for ${component}`);
      return '';
    } catch (err: any) {
      console.error(`[system] Backup before ${component} failed:`, err.message || err);
      return '';
    }
  }

  /**
   * `run('sudo', argv)` when `needsSudo()`, `run(argv[0], argv.slice(1))`
   * otherwise -- the same per-call sudo-split idiom every other migrated
   * service in this codebase uses (see e.g. `services/pipeSources.ts`'s
   * `removeServiceFile()`/`ensureRuntimeDir()`), pulled into one shared
   * helper here since Task 11 needed it at many call sites across
   * install/uninstall/update. Never string-concatenates `sudo` into a
   * binary name -- that was the exact "false sudo split" bug a previous
   * task caught (see this file's test suite for the exact-argv assertions
   * that guard against it recurring).
   */
  private async runPrivileged(argv: string[]) {
    return needsSudo() ? run('sudo', argv) : run(argv[0], argv.slice(1));
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

  private async getDistroCodename(): Promise<string> {
    if (this.distroCodename) return this.distroCodename;

    try {
      // Try lsb_release first
      const output = await this.runCommand('lsb_release -cs 2>/dev/null');
      this.distroCodename = output.trim();
      if (this.distroCodename) return this.distroCodename;
    } catch (e) {}

    try {
      // Fallback to /etc/os-release
      const output = await this.runCommand('grep VERSION_CODENAME /etc/os-release | cut -d= -f2');
      this.distroCodename = output.trim().replace(/"/g, '');
      if (this.distroCodename) return this.distroCodename;
    } catch (e) {}

    // Ultimate fallback for many debian-based systems if detection fails
    return 'bookworm';
  }

  private async updateSnapserverFromGitHub(clean: boolean = false): Promise<string> {
    const release = await this.getLatestGitHubRelease('badaix', 'snapcast');
    const arch = await this.runCommand('dpkg --print-architecture');
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
    const arch = await this.runCommand('dpkg --print-architecture');
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

  private async executeDebUpdate(downloadUrl: string, fileName: string, clean: boolean = false, pkg: 'snapserver' | 'snapclient' = 'snapserver'): Promise<string> {
    const debFile = `/tmp/${fileName}`;
    console.log(`Downloading ${pkg} from ${downloadUrl}... (Clean: ${clean})`);

    let cleanCmd = '';
    if (clean) {
      if (pkg === 'snapclient') {
        cleanCmd = `
          ${this.SUDO}systemctl stop snapclient || true && \
          ${this.SUDO}dpkg --purge snapclient || true && \
          ${this.SUDO}rm -f /etc/default/snapclient && \
        `;
      } else {
        cleanCmd = `
          ${this.SUDO}systemctl stop snapserver || true && \
          ${this.SUDO}dpkg --purge snapserver || true && \
          ${this.SUDO}rm -rf /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.d /var/lib/snapserver && \
        `;
      }
    }

    const postInstallCmd = pkg === 'snapclient'
      ? `${this.SUDO}systemctl daemon-reload && ${this.SUDO}systemctl restart snapclient`
      : `${this.SUDO}mkdir -p /var/lib/snapserver && \
      ${this.SUDO}chown -R snapserver:snapserver /var/lib/snapserver && \
      ${this.SUDO}usermod -d /var/lib/snapserver snapserver 2>/dev/null || true && \
      ${this.SUDO}systemctl daemon-reload && \
      ${this.SUDO}systemctl restart snapserver`;

    const dpkgFlags = '--force-confdef --force-confold';

    return this.runCommand(`
      ${cleanCmd}
      ${this.SUDO}apt-get update && \
      wget -qO ${debFile} "${downloadUrl}" && \
      (${this.SUDO}dpkg -i ${dpkgFlags} ${debFile} 2>&1 || ${this.SUDO}DEBIAN_FRONTEND=noninteractive apt-get install -f -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold") && \
      rm -f ${debFile} && \
      ${postInstallCmd}
    `);
  }

  async updateNodeJs(version: string = '22'): Promise<string> {
    if (!/^\d{1,2}$/.test(version)) {
      throw new Error('Invalid Node.js major version');
    }
    this.invalidatePackageCache();
    console.log(`Updating Node.js to version ${version}...`);

    const setupUrl = `https://deb.nodesource.com/setup_${version}.x`;
    const setupResponse = await fetch(setupUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!setupResponse.ok) {
      throw new Error(`Failed to download NodeSource setup script: HTTP ${setupResponse.status} for ${setupUrl}`);
    }
    const script = await setupResponse.text();

    jobService.log(`$ fetch ${setupUrl} | bash -`);
    // `bash -` reads its script from stdin -- no shell pipe involved: the
    // fetched script text is handed to run() as its `input` (stdin) option
    // directly, in-process. `-E` (preserve environment) is kept only on the
    // sudo-prefixed path, matching the original `sudo -E bash -`.
    if (needsSudo()) {
      await run('sudo', ['-E', 'bash', '-'], { input: script });
    } else {
      await run('bash', ['-'], { input: script });
    }

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
      console.error(`[getServiceLogs] Failed for ${service}:`, error.message || error);
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
      console.error(`Error checking latest version for ${pkg}:`, error);
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

  async installShairportSync(): Promise<string> {
      console.log('Installing shairport-sync and nqptp from source... (AirPlay 2)');
      const cmd = `
        echo "Installing build dependencies..." && \
        ${this.SUDO}apt-get update && \
        (${this.SUDO}apt-get install -y --no-install-recommends systemd-dev 2>/dev/null || true) && \
        ${this.SUDO}apt-get install -y --no-install-recommends build-essential git autoconf automake libtool \
          libpopt-dev libconfig-dev libasound2-dev avahi-daemon libavahi-client-dev \
          libssl-dev libsoxr-dev libplist-dev libsodium-dev uuid-dev libgcrypt-dev xxd \
          libplist-utils libavutil-dev libavcodec-dev libavformat-dev && \
        echo "Cleaning up absolute legacy installations..." && \
        ${this.SUDO}apt-get remove --purge -y shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl stop shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl disable shairport-sync 2>/dev/null || true && \
        ${this.SUDO}systemctl stop nqptp 2>/dev/null || true && \
        ${this.SUDO}systemctl disable nqptp 2>/dev/null || true && \
        ${this.SUDO}rm -f /usr/local/bin/shairport-sync /usr/bin/shairport-sync /usr/local/bin/nqptp /usr/bin/nqptp && \
        ${this.SUDO}rm -f /etc/systemd/system/shairport-sync.service /etc/systemd/system/nqptp.service && \
        ${this.SUDO}rm -f /lib/systemd/system/shairport-sync.service /lib/systemd/system/nqptp.service && \

        echo "Building and installing nqptp..." && \
        rm -rf /tmp/nqptp-build && \
        git clone https://github.com/mikebrady/nqptp.git /tmp/nqptp-build && \
        cd /tmp/nqptp-build && \
        autoreconf -fvi && \
        ./configure --with-systemd-startup && \
        make -j$(nproc) && \
        ${this.SUDO}make install && \
        ${this.SUDO}systemctl daemon-reload && \
        ${this.SUDO}systemctl enable nqptp && \
        ${this.SUDO}systemctl restart nqptp && \

        echo "Building and installing shairport-sync..." && \
        rm -rf /tmp/shairport-sync-build && \
        git clone https://github.com/mikebrady/shairport-sync.git /tmp/shairport-sync-build && \
        cd /tmp/shairport-sync-build && \
        autoreconf -fvi && \
        ./configure --sysconfdir=/etc --with-alsa --with-soxr --with-avahi --with-ssl=openssl --with-systemd-startup --with-airplay-2 --with-metadata && \
        make -j$(nproc) && \
        ${this.SUDO}make install && \

        echo "Setting up systemd service and user access..." && \
        if ! getent group "shairport-sync" >/dev/null 2>&1; then \
          ${this.SUDO}groupadd -r shairport-sync || true; \
        fi && \
        if ! id "shairport-sync" >/dev/null 2>&1; then \
          ${this.SUDO}useradd -r -M -g shairport-sync -s /usr/sbin/nologin -G audio shairport-sync || true; \
        fi && \

        ${this.SUDO}systemctl daemon-reload && \
        ${this.SUDO}systemctl enable shairport-sync && \
        ${this.SUDO}systemctl restart shairport-sync && \
        echo "Shairport-sync and nqptp installed successfully."
      `;
      return this.runCommand(cmd);
  }

  async installSnapCtrl(): Promise<string> {
      this.invalidatePackageCache();
      await this.safeBackup('snap-ctrl');
      const repo = 'NaturalDevCR/snap-ctrl';
      const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const installPath = '/usr/share/snapserver/snap-ctrl';
      const docRootPath = '/usr/share/snapserver/snap-ctrl/dist';

      console.log(`Installing snap-ctrl from ${apiUrl}...`);

      // snap-ctrl releases ship pre-built frontend zips (dist.zip / dist-ha.zip),
      // each containing a top-level dist/ folder and NO package.json. We pick the
      // standalone dist.zip, locate the built dist/index.html, install it to
      // installPath/dist (which is the doc_root), and record the release tag in a
      // marker file so the version can be reported afterwards.
      const cmd = `
        set -e
        EXTRACT_DIR=/tmp/snap-ctrl-extract
        rm -rf /tmp/snap-ctrl-download $EXTRACT_DIR && \
        mkdir -p /tmp/snap-ctrl-download $EXTRACT_DIR && \
        cd /tmp/snap-ctrl-download && \
        API_JSON=$(curl -sL -H 'Accept: application/vnd.github+json' ${apiUrl}) && \
        DOWNLOAD_URL=$(printf '%s' "$API_JSON" | python3 -c "import json,sys;d=json.load(sys.stdin);z=[a for a in d.get('assets',[]) if a.get('name','').lower().endswith('.zip')];exact=[a['browser_download_url'] for a in z if a.get('name','').lower()=='dist.zip'];noha=[a['browser_download_url'] for a in z if 'ha' not in a.get('name','').lower()];print(exact[0] if exact else (noha[0] if noha else (z[0]['browser_download_url'] if z else '')))") && \
        TAG=$(printf '%s' "$API_JSON" | python3 -c "import json,sys;print(json.load(sys.stdin).get('tag_name',''))") && \
        if [ -z "$DOWNLOAD_URL" ]; then
            echo "No release .zip asset found, falling back to zipball_url";
            DOWNLOAD_URL=$(printf '%s' "$API_JSON" | python3 -c "import json,sys;d=json.load(sys.stdin); print(d.get('zipball_url',''))");
        fi && \
        if [ -z "$DOWNLOAD_URL" ]; then echo "Error: Could not find download URL" && exit 1; fi && \
        echo "Downloading snap-ctrl $TAG: $DOWNLOAD_URL" && \
        wget --no-check-certificate -qO snap-ctrl.zip "$DOWNLOAD_URL" && \
        unzip -qo snap-ctrl.zip -d $EXTRACT_DIR && \
        INDEX=$(find $EXTRACT_DIR -type f -name index.html -path '*/dist/*' -print -quit) && \
        if [ -z "$INDEX" ]; then INDEX=$(find $EXTRACT_DIR -type f -name index.html -print -quit); fi && \
        if [ -z "$INDEX" ]; then echo "Error: no built index.html found in snap-ctrl archive" && exit 1; fi && \
        DIST_DIR=$(dirname "$INDEX") && \
        echo "Found built interface at: $DIST_DIR" && \
        ${this.SUDO}mkdir -p ${installPath} && \
        ${this.SUDO}rm -rf ${installPath}/* ${installPath}/.[!.]* 2>/dev/null || true && \
        ${this.SUDO}mkdir -p ${docRootPath} && \
        ${this.SUDO}cp -rT "$DIST_DIR" ${docRootPath} && \
        printf '%s' "$TAG" | ${this.SUDO}tee ${installPath}/.snap-ctrl-version >/dev/null && \
        rm -rf /tmp/snap-ctrl-download $EXTRACT_DIR
      `;

      const result = await this.runCommand(cmd);

      try {
          await configService.setSnapserverDocRoot(docRootPath);
          await this.restartService('snapserver');
      } catch (err) {
          console.error('Failed to update snapserver config for snap-ctrl:', err);
      }

      return result;
  }

}

export const systemService = new SystemService();
