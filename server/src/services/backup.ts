import { exec } from 'child_process';
import fs from 'fs/promises';
import util from 'util';

const execAsync = util.promisify(exec);

const BACKUP_DIR = '/var/backups/snapmanager';
const MAX_BACKUPS = 15;

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
  private get SUDO(): string {
    return (process as any).getuid?.() === 0 ? '' : 'sudo ';
  }

  private async run(cmd: string, options: { allowFail?: boolean } = {}): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
      if (stderr && stderr.trim()) {
        const lower = stderr.toLowerCase();
        if (lower.includes('error') || lower.includes('failed')) {
          console.warn(`[backup] stderr from ${cmd}:`, stderr);
        }
      }
      return stdout;
    } catch (err: any) {
      if (options.allowFail) return '';
      throw new Error(`Backup command failed: ${cmd}\n${err.stderr || err.message}`);
    }
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
    await this.run(`${this.SUDO}mkdir -p ${BACKUP_DIR}`);
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

  private async resolveExistingSources(sources: string[]): Promise<string[]> {
    const existing: string[] = [];
    for (const src of sources) {
      if (await this.pathExists(src)) existing.push(src);
    }
    try {
      const { stdout } = await execAsync(
        `${this.SUDO}ls -1 /etc/systemd/system/snapclient-manager-*.service 2>/dev/null || true`
      );
      for (const line of stdout.split('\n')) {
        const f = line.trim();
        if (f) existing.push(f);
      }
    } catch {
      // ignore
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

    const archiveArgs: string[] = ['czf', fullPath, '--absolute-names'];
    for (const src of existing) {
      archiveArgs.push(src);
    }

    const tarCmd = `${this.SUDO}tar ${archiveArgs.map(a => (a.includes(' ') ? `'${a}'` : a)).join(' ')}`;
    await this.run(tarCmd);

    await this.run(`${this.SUDO}chmod 600 ${fullPath}`);

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
          await this.run(`${this.SUDO}rm -f ${BACKUP_DIR}/${f}`).catch(() => {});
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

    const extractCmd = `${this.SUDO}tar -xPzf ${fullPath}`;
    await this.run(extractCmd);
    return `Restored from ${fullPath}`;
  }

  async deleteBackup(backupName: string): Promise<void> {
    if (!/^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$/.test(backupName)) {
      throw new Error('Invalid backup name format');
    }
    const fullPath = `${BACKUP_DIR}/${backupName}`;
    await this.run(`${this.SUDO}rm -f ${fullPath}`);
  }
}

export const backupService = new BackupService();
