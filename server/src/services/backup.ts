// Shell-free wrapper around backup creation/restore/cleanup, built on top of
// `platform/exec.ts`'s `run()` (argv arrays only, no shell -- see that
// file's header). Task 10 migration -- see docs/superpowers/sdd/
// task-10-report.md for the full writeup.
//
// This file's shell-command-injection risk was already lower than
// services/pipeSources.ts's or services/tools.ts's before this migration:
// the only two places outside input reaches this file (`restoreBackup()`
// and `deleteBackup()`) are already guarded by the
// `/^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$/` filename regex below, unchanged
// by this task. Still, every command here used to be built via
// `child_process.exec()` string interpolation -- this migrates every call
// site onto `platform/exec.ts`'s argv-based `run()` for consistency and to
// close `check-no-shell-injection.sh` across the codebase.

import fs from 'fs/promises';
import { run, needsSudo } from '../platform/exec';
import { dbDir } from '../database';
import { WATCHDOGS_CONFIG_DIR } from './watchdog';
import { MPD_CONF_PATHS } from './pipeSources';

const BACKUP_DIR = '/var/backups/snapmanager';
const MAX_BACKUPS = 15;

// The directory `resolveExistingSources()` scans for dynamically-named
// managed unit files (`snapclient-manager-*.service`,
// `snapcast-radio-*.service`) -- see that function's docstring for why
// this is now an `fs.readdir()` + regex scan instead of a shell `ls` glob.
const SYSTEMD_DIR = '/etc/systemd/system';

// myMPD's own config directory -- confirmed real (not invented) via
// services/system.ts's getMympdInfo(), which already reads
// `/var/lib/mympd/config/http_port` from here; that's myMPD's default
// data/config directory on a Debian/OBS-repo install (Task 60
// investigation). No existing service module exports a named constant for
// this (unlike WATCHDOGS_CONFIG_DIR/MPD_CONF_PATHS/dbDir above), and
// system.ts already depends on backup.ts (importing the other direction
// would be circular), so this is defined locally here instead.
const MYMPD_CONFIG_DIR = '/var/lib/mympd/config';

// shairport-sync's real config file. Confirmed (not assumed) by reading
// the actual upstream build this app's own server/scripts/install-shairport-sync.sh
// invokes: `./configure --sysconfdir=/etc ...` (no `--without-configfiles`),
// and shairport-sync's own configure.ac defaults `with_configfiles` to
// `yes`, so `make install` runs its `config-file-install-local` target,
// which writes `$(sysconfdir)/shairport-sync.conf` (i.e. `/etc/shairport-sync.conf`
// given `--sysconfdir=/etc`) if one doesn't already exist, alongside a
// `.sample` copy. This is a real, persistent config file this app's
// install path creates, not an invented path (Task 60 investigation).
const SHAIRPORT_SYNC_CONF = '/etc/shairport-sync.conf';

export type BackupComponent =
  | 'snapserver'
  | 'snapclient'
  | 'snap-ctrl'
  | 'shairport-sync'
  | 'mpd'
  | 'mympd'
  | 'ffmpeg'
  | 'node'
  | 'general';

export interface BackupResult {
  path: string;
  fileName: string;
  size: number;
  timestamp: string;
  components: string[];
  files: string[];
}

export interface BackupEntry {
  name: string;
  size: number;
  mtime: string;
  components: string[];
}

export class BackupService {
  /**
   * Runs `bin` with `args` via `platform/exec.ts`'s `run()`, sudo-prefixed
   * following the idiom established in `platform/systemd.ts`'s internal
   * `systemctl()` helper: `needsSudo() ? run('sudo', [bin, ...args]) :
   * run(bin, args)`. Every mutating command this service issues (`mkdir`,
   * `tar`, `chmod`, `rm`) needs root on a normal Debian install (`/var/
   * backups/snapmanager` and `/etc/systemd/system` are root-owned), so
   * unlike `platform/systemd.ts`'s read/write split (`activeState()` never
   * sudo-prefixes; `control()` always does), every call site in this file
   * sudo-gates via `needsSudo()` -- there is no unprivileged variant here.
   */
  private privileged(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return needsSudo() ? run('sudo', [bin, ...args]) : run(bin, args);
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureBackupDir(): Promise<void> {
    await this.privileged('mkdir', ['-p', BACKUP_DIR]);
  }

  private formatTimestamp(): string {
    const d = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
    );
  }

  /**
   * Task 60: genuinely component-aware source collection -- the structural
   * fix for Task 59 review Finding 1 (`.superpowers/sdd/task-59-review.md`),
   * which caught this method building the SAME `sources` array (always
   * `/etc/snapserver.conf*` + `/etc/snapclient-manager`) regardless of
   * `component`. A pre-install backup for mpd/mympd/shairport-sync never
   * contained anything relevant to those packages, so
   * `verifyServiceOrRollback()` in system.ts had to treat them the same as
   * "no backup exists" rather than risk a misleadingly-labeled rollback
   * (see `NO_COMPONENT_SPECIFIC_BACKUP_PKGS` there). This task closes that
   * loop: each component below gets ONLY the fixed paths and dynamic unit
   * patterns genuinely relevant to it (verified against the real managing
   * code, not guessed -- see each path's own comment), except for two
   * cross-cutting sources included in EVERY backup regardless of
   * `component`:
   *   - `dbDir` (services/database.ts): the manager's own SQLite database
   *     directory. Restoring any single component without also being able
   *     to restore the manager's own data/config history alongside it
   *     would be an incomplete rollback.
   *   - `WATCHDOGS_CONFIG_DIR` (services/watchdog.ts, `/etc/snapcast-manager`):
   *     this app's own persisted config directory.
   *   - The `snapcast-radio-*.service` dynamic unit pattern (services/
   *     pipeSources.ts's `getSystemdServiceName()`): pipe/radio source
   *     DEFINITIONS live in the manager's own database (already covered by
   *     `dbDir` above), but the generated systemd unit FILES are
   *     filesystem state this app creates independently of any single
   *     installable package (there is no "pipe-source" `BackupComponent`
   *     or `PackageName` at all) -- so they're captured in every backup
   *     rather than gated to one component, matching the plan item's
   *     unqualified "unidades gestionadas" (managed units) wording.
   *
   * `'general'` (the fallback `mapToComponent()` uses only for a package it
   * doesn't recognize at all) deliberately becomes the UNION of every
   * component-specific branch below -- broadest-but-safe, since an unknown
   * target gives no way to tell which subset would actually be relevant.
   *
   * `ffmpeg` and `node` get ONLY the cross-cutting sources: neither has an
   * app-managed config file this codebase creates, writes, or reads
   * anywhere (verified by grepping services/system.ts's installer/updater
   * bodies for both) -- they're plain CLI tools/runtimes with no
   * persistent state of their own to back up.
   */
  private collectSources(component: BackupComponent): {
    sources: string[];
    components: string[];
    dynamicUnitPatterns: RegExp[];
  } {
    const sources: string[] = [];
    const components: string[] = [];
    const dynamicUnitPatterns: RegExp[] = [];

    const includeAll = component === 'general';

    // ---- cross-cutting: every component ----
    sources.push(dbDir);
    components.push('snapmanager-data');
    sources.push(WATCHDOGS_CONFIG_DIR);
    components.push('snapmanager-config');
    dynamicUnitPatterns.push(/^snapcast-radio-.*\.service$/);

    // ---- snapserver: /etc/snapserver.conf* (already there) plus the
    // daemon's own persistent data directory (server.json -- volumes,
    // client/group state) and its single-slot rotating backup file, both
    // confirmed real via system.ts's own executeDebUpdate()/setup code,
    // which creates, chowns, and purges /var/lib/snapserver, and
    // config.ts's SNAPSERVER_CONFIG_BAK. ----
    if (component === 'snapserver' || includeAll) {
      sources.push(
        '/etc/snapserver.conf',
        '/etc/snapserver.conf.base',
        '/etc/snapserver.conf.d',
        '/etc/snapserver.conf.bak',
        '/var/lib/snapserver',
      );
      components.push('snapserver-config');
    }

    // ---- snapclient: /etc/snapclient-manager (already there, the
    // per-instance env-file directory snapclientInstances.ts manages) plus
    // /etc/default/snapclient (the legacy single-instance config
    // routes/config.ts actively reads/writes) and the dynamic
    // snapclient-manager-*.service unit scan (already there). ----
    if (component === 'snapclient' || includeAll) {
      sources.push('/etc/snapclient-manager', '/etc/default/snapclient');
      components.push('snapclient-config');
      dynamicUnitPatterns.push(/^snapclient-manager-.*\.service$/);
    }

    if (component === 'snap-ctrl' || includeAll) {
      sources.push('/usr/share/snapserver/snap-ctrl');
      components.push('snap-ctrl-install');
    }

    // ---- mpd: MPD_CONF_PATHS (primary /etc/mpd.conf, fallback
    // /var/lib/mpd/mpd.conf -- pipeSources.ts's own findMpdConf() already
    // treats these as an ordered fallback pair; resolveExistingSources()'s
    // per-path existence filter naturally keeps only whichever one(s)
    // actually exist, reproducing the same fallback semantics without any
    // special-casing here). ----
    if (component === 'mpd' || includeAll) {
      sources.push(...MPD_CONF_PATHS);
      components.push('mpd-config');
    }

    // ---- mympd: its own config directory (see MYMPD_CONFIG_DIR's
    // comment above this class for how this was confirmed real). ----
    if (component === 'mympd' || includeAll) {
      sources.push(MYMPD_CONFIG_DIR);
      components.push('mympd-config');
    }

    // ---- shairport-sync: its real config file (see SHAIRPORT_SYNC_CONF's
    // comment above this class for how this was confirmed real, not
    // assumed). ----
    if (component === 'shairport-sync' || includeAll) {
      sources.push(SHAIRPORT_SYNC_CONF);
      components.push('shairport-sync-config');
    }

    return { sources, components: Array.from(new Set(components)), dynamicUnitPatterns };
  }

  /**
   * Resolves which of `sources` (fixed, hardcoded paths from
   * `collectSources()`) actually exist on disk, PLUS any dynamically-named
   * managed unit files under `/etc/systemd/system` matching ANY of
   * `dynamicUnitPatterns` (also decided by `collectSources()`, per
   * component -- Task 60 generalized this from a single hardcoded
   * `snapclient-manager-*.service` pattern into a caller-supplied list so
   * the directory is genuinely only scanned for patterns relevant to the
   * component being backed up; an empty list skips the scan, and thus the
   * `fs.readdir()` call, entirely).
   *
   * The dynamic-unit part used to be a shell glob:
   *   `${SUDO}ls -1 /etc/systemd/system/snapclient-manager-*.service 2>/dev/null || true`
   * Shell globbing (`*`) only expands inside an actual shell -- argv-based
   * `execFile`/`run()` CANNOT replicate this (passing the literal string
   * `'snapclient-manager-*.service'` as an argv element to `ls` would not
   * expand it; `ls` would just fail to find a file with that literal
   * name). Reintroducing a shell call to preserve the glob would undo the
   * entire point of this migration, so instead this lists the directory
   * with `fs.promises.readdir()` and filters the entries in-process with
   * regexes equivalent to each glob pattern (`^snapclient-manager-.*\.service$`
   * for `snapclient-manager-*.service`, `^snapcast-radio-.*\.service$` for
   * `snapcast-radio-*.service`), then maps each match back to its full path
   * under `SYSTEMD_DIR`. This is simpler, safer, and more idiomatic Node
   * than shelling out to `ls` ever was.
   *
   * Equivalence with the original shell behavior:
   *  - Match semantics: shell glob `*` matches any sequence of characters
   *    (excluding `/`, irrelevant here since we're only matching bare
   *    filenames within one directory) -- `.*` in each regex is the exact
   *    same "any characters" semantics for a single path segment.
   *  - Zero matches: the original appended `|| true` specifically so an
   *    empty/no-match `ls` (which exits non-zero when its glob expands to
   *    nothing, because the shell passes the literal unexpanded pattern to
   *    `ls` and `ls` reports "no such file") was swallowed into empty
   *    stdout rather than aborting the whole backup. Here, zero regex
   *    matches naturally produces zero appended paths -- no special-casing
   *    needed.
   *  - Directory missing/unreadable: the original's `2>/dev/null || true`
   *    swallows `ls`'s stderr and lets `|| true` force a zero exit
   *    regardless of the underlying reason (directory missing, permission
   *    denied, ...) -- the effect is "found nothing" either way. The
   *    try/catch below reproduces that exact "found nothing" outcome for
   *    ANY `fs.readdir()` failure (ENOENT, EACCES, or anything else),
   *    without needing sudo -- `/etc/systemd/system` is world-readable on a
   *    normal Debian install, and even a hardened install that restricted
   *    it would need the same underlying permission via any listing method,
   *    shell-based or not.
   */
  private async resolveExistingSources(sources: string[], dynamicUnitPatterns: RegExp[] = []): Promise<string[]> {
    const existing: string[] = [];
    for (const src of sources) {
      if (await this.pathExists(src)) existing.push(src);
    }
    if (dynamicUnitPatterns.length === 0) return existing;
    try {
      const entries = await fs.readdir(SYSTEMD_DIR);
      for (const entry of entries) {
        if (dynamicUnitPatterns.some(pattern => pattern.test(entry))) {
          existing.push(`${SYSTEMD_DIR}/${entry}`);
        }
      }
    } catch {
      // Directory missing/unreadable -- treat as "found nothing", exactly
      // like the original shell command's `2>/dev/null || true`.
    }
    return existing;
  }

  async createPreUpdateBackup(component: BackupComponent): Promise<BackupResult> {
    await this.ensureBackupDir();

    const { sources, components, dynamicUnitPatterns } = this.collectSources(component);
    const existing = await this.resolveExistingSources(sources, dynamicUnitPatterns);

    if (existing.length === 0) {
      console.warn(`[backup] No existing files to back up for ${component}; skipping.`);
      return {
        path: '',
        fileName: '',
        size: 0,
        timestamp: this.formatTimestamp(),
        components,
        files: [],
      };
    }

    const fileName = `pre-${component}-${this.formatTimestamp()}.tar.gz`;
    const fullPath = `${BACKUP_DIR}/${fileName}`;

    // Argv-based `run()` needs no manual quoting at all: each element of
    // this array is passed to execFile as a literal argument, spaces and
    // all -- unlike the old shell-string approach, there is no quoting
    // logic here to get wrong.
    const archiveArgs: string[] = ['czf', fullPath, '--absolute-names', ...existing];
    await this.privileged('tar', archiveArgs);

    await this.privileged('chmod', ['600', fullPath]);

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) throw new Error(`Backup file ${fullPath} could not be stat'd`);

    await this.cleanupOldBackups();

    console.log(`[backup] Created ${fullPath} (${stat.size} bytes) covering: ${components.join(', ')}`);

    return {
      path: fullPath,
      fileName,
      size: stat.size,
      timestamp: this.formatTimestamp(),
      components,
      files: existing,
    };
  }

  private async cleanupOldBackups(): Promise<void> {
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const backups = files
        .filter(f => f.startsWith('pre-') && f.endsWith('.tar.gz'))
        .sort();
      if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(0, backups.length - MAX_BACKUPS);
        for (const f of toDelete) {
          await this.privileged('rm', ['-f', `${BACKUP_DIR}/${f}`]).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[backup] Cleanup failed:', err);
    }
  }

  async listBackups(): Promise<BackupEntry[]> {
    await this.ensureBackupDir();
    try {
      const files = await fs.readdir(BACKUP_DIR);
      const result: BackupEntry[] = [];
      for (const f of files) {
        if (!f.endsWith('.tar.gz')) continue;
        const fullPath = `${BACKUP_DIR}/${f}`;
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat) continue;
        const componentMatch = f.match(/^pre-([a-z\-]+)-/);
        result.push({
          name: f,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          components: componentMatch ? [componentMatch[1]] : [],
        });
      }
      return result.sort((a, b) => b.mtime.localeCompare(a.mtime));
    } catch {
      return [];
    }
  }

  async restoreBackup(backupName: string): Promise<string> {
    if (!/^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$/.test(backupName)) {
      throw new Error('Invalid backup name format');
    }
    const fullPath = `${BACKUP_DIR}/${backupName}`;
    if (!(await this.pathExists(fullPath))) {
      throw new Error(`Backup ${backupName} not found`);
    }

    await this.privileged('tar', ['-xPzf', fullPath]);
    return `Restored from ${fullPath}`;
  }

  async deleteBackup(backupName: string): Promise<void> {
    if (!/^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$/.test(backupName)) {
      throw new Error('Invalid backup name format');
    }
    const fullPath = `${BACKUP_DIR}/${backupName}`;
    await this.privileged('rm', ['-f', fullPath]);
  }
}

export const backupService = new BackupService();
