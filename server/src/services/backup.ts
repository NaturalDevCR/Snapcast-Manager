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

const BACKUP_DIR = '/var/backups/snapmanager';
const MAX_BACKUPS = 15;

// The directory `resolveExistingSources()` scans for
// `snapclient-manager-*.service` unit files -- see that function's
// docstring for why this is now an `fs.readdir()` + regex scan instead of a
// shell `ls` glob.
const SYSTEMD_DIR = '/etc/systemd/system';

export type BackupComponent =
  | 'snapserver'
  | 'snapclient'
  | 'snap-ctrl'
  | 'shairport-sync'
  | 'mpd'
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

  private collectSources(component: BackupComponent): { sources: string[]; components: string[] } {
    const sources: string[] = [];
    const components: string[] = [];

    const includeAll = component === 'general';

    sources.push('/etc/snapserver.conf');
    sources.push('/etc/snapserver.conf.base');
    sources.push('/etc/snapserver.conf.d');
    components.push('snapserver-config');

    sources.push('/etc/snapclient-manager');
    components.push('snapclient-config');

    if (component === 'snap-ctrl' || includeAll) {
      sources.push('/usr/share/snapserver/snap-ctrl');
      components.push('snap-ctrl-install');
    }

    if (component === 'snapserver') {
      components.push('snapserver-config', 'snap-ctrl-install');
    }
    if (component === 'snapclient') {
      components.push('snapclient-config');
    }

    return { sources, components: Array.from(new Set(components)) };
  }

  /**
   * Resolves which of `sources` (fixed, hardcoded paths from
   * `collectSources()`) actually exist on disk, PLUS any dynamically-named
   * `snapclient-manager-*.service` unit files under `/etc/systemd/system`.
   *
   * The latter used to be a shell glob:
   *   `${SUDO}ls -1 /etc/systemd/system/snapclient-manager-*.service 2>/dev/null || true`
   * Shell globbing (`*`) only expands inside an actual shell -- argv-based
   * `execFile`/`run()` CANNOT replicate this (passing the literal string
   * `'snapclient-manager-*.service'` as an argv element to `ls` would not
   * expand it; `ls` would just fail to find a file with that literal
   * name). Reintroducing a shell call to preserve the glob would undo the
   * entire point of this migration, so instead this lists the directory
   * with `fs.promises.readdir()` and filters the entries in-process with a
   * regex equivalent to the glob pattern (`^snapclient-manager-.*\.service$`
   * for `snapclient-manager-*.service`), then maps each match back to its
   * full path under `SYSTEMD_DIR`. This is simpler, safer, and more
   * idiomatic Node than shelling out to `ls` ever was.
   *
   * Equivalence with the original shell behavior:
   *  - Match semantics: shell glob `*` matches any sequence of characters
   *    (excluding `/`, irrelevant here since we're only matching bare
   *    filenames within one directory) -- `.*` in the regex is the exact
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
  private async resolveExistingSources(sources: string[]): Promise<string[]> {
    const existing: string[] = [];
    for (const src of sources) {
      if (await this.pathExists(src)) existing.push(src);
    }
    try {
      const entries = await fs.readdir(SYSTEMD_DIR);
      const pattern = /^snapclient-manager-.*\.service$/;
      for (const entry of entries) {
        if (pattern.test(entry)) existing.push(`${SYSTEMD_DIR}/${entry}`);
      }
    } catch {
      // Directory missing/unreadable -- treat as "found nothing", exactly
      // like the original shell command's `2>/dev/null || true`.
    }
    return existing;
  }

  async createPreUpdateBackup(component: BackupComponent): Promise<BackupResult> {
    await this.ensureBackupDir();

    const { sources, components } = this.collectSources(component);
    const existing = await this.resolveExistingSources(sources);

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
