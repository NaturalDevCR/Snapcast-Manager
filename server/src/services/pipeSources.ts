import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../database';
import { configService } from './config';

const execAsync = util.promisify(exec);

export type PipeSourceType = 'radio' | 'mpd';

export interface PipeSource {
  id: string;
  name: string;
  type: PipeSourceType;
  url: string;
  reconnect: boolean;
  reconnectStreamed: boolean;
  reconnectAtEof: boolean;
  reconnectDelayMax: number;
  idleThreshold: number;
  enabled: boolean;
  createdAt: string;
}

export interface PipeSourceWithStatus extends PipeSource {
  status: string;
  fifoPath: string;
  serviceName: string;
}

export interface ExistingService {
  name: string;
  filePath: string;
  url: string;
  reconnect: boolean;
  reconnectStreamed: boolean;
  reconnectAtEof: boolean;
  reconnectDelayMax: number;
  isActive: boolean;
}

export interface DiscoveredPipe {
  name: string;
  fifoPath: string;
  sourceUri: string;
  idleThreshold: number;
  detectedType: PipeSourceType;
  existingService: ExistingService | null;
}

export interface AdoptInput extends Omit<PipeSource, 'id' | 'createdAt'> {
  existingServiceName?: string;
}

// ---- slug helpers ----
function underscoreSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function hyphenSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---- path helpers (exported for route use) ----
export function getFifoPath(name: string): string {
  return `/tmp/snapfifo_${underscoreSlug(name)}`;
}

export function getSystemdServiceName(name: string): string {
  return `snapcast-radio-${hyphenSlug(name)}`;
}

function getServiceFilePath(name: string): string {
  return `/etc/systemd/system/${getSystemdServiceName(name)}.service`;
}

// ---- snapserver source URI ----
function buildSourceUri(pipe: PipeSource): string {
  const fifo = getFifoPath(pipe.name);
  const encodedName = encodeURIComponent(pipe.name);
  return `pipe://${fifo}?name=${encodedName}&codec=pcm&sampleformat=48000:16:2&idle_threshold=${pipe.idleThreshold}&send_silence=true&mode=create`;
}

// ---- radio: systemd service file ----
function buildRadioServiceContent(pipe: PipeSource): string {
  const fifo = getFifoPath(pipe.name);
  const flags = [
    pipe.reconnect ? '-reconnect 1' : '',
    pipe.reconnectStreamed ? '-reconnect_streamed 1' : '',
    pipe.reconnectAtEof ? '-reconnect_at_eof 1' : '',
    `-reconnect_delay_max ${pipe.reconnectDelayMax}`,
  ].filter(Boolean).join(' ');

  return `[Unit]
Description=Radio Stream: ${pipe.name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
ExecStartPre=/bin/bash -c 'test -p ${fifo} || mkfifo -m 666 ${fifo}'
ExecStart=/usr/bin/ffmpeg -hide_banner ${flags} -i "${pipe.url}" -f s16le -ar 48000 -ac 2 -y ${fifo}
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

// ---- MPD: audio_output block management ----
const MPD_CONF_PATHS = ['/etc/mpd.conf', '/var/lib/mpd/mpd.conf'];

async function findMpdConf(): Promise<string | null> {
  for (const p of MPD_CONF_PATHS) {
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

function buildMpdAudioOutputBlock(name: string, fifoPath: string): string {
  return `
audio_output {
\ttype\t\t"fifo"
\tname\t\t"${name}"
\tpath\t\t"${fifoPath}"
\tformat\t\t"48000:16:2"
\tmixer_type\t"null"
}`;
}

function removeMpdOutputBlock(content: string, fifoPath: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inBlock = false;
  let blockContainsFifo = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    if (!inBlock) {
      if (/^\s*audio_output\s*\{/.test(line)) {
        inBlock = true;
        blockLines = [line];
        blockContainsFifo = false;
      } else {
        result.push(line);
      }
    } else {
      blockLines.push(line);
      if (line.includes(fifoPath)) blockContainsFifo = true;
      if (/^\s*\}/.test(line)) {
        inBlock = false;
        if (!blockContainsFifo) result.push(...blockLines);
        blockLines = [];
      }
    }
  }

  return result.join('\n');
}

// ---- service class ----
export class PipeSourceService {
  private get SUDO(): string {
    return (process as any).getuid?.() === 0 ? '' : 'sudo ';
  }

  private async run(cmd: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(cmd);
      if (stderr) console.warn(`[pipeSources] ${stderr.trim()}`);
      return stdout;
    } catch (err: any) {
      console.error(`[pipeSources] cmd failed: ${cmd}`, err.message);
      throw err;
    }
  }

  private rowToModel(row: any): PipeSource {
    return {
      id: row.id,
      name: row.name,
      type: (row.type || 'radio') as PipeSourceType,
      url: row.url,
      reconnect: !!row.reconnect,
      reconnectStreamed: !!row.reconnect_streamed,
      reconnectAtEof: !!row.reconnect_at_eof,
      reconnectDelayMax: row.reconnect_delay_max,
      idleThreshold: row.idle_threshold,
      enabled: !!row.enabled,
      createdAt: row.created_at,
    };
  }

  list(): PipeSource[] {
    const rows = db.prepare('SELECT * FROM radio_pipe_streams ORDER BY created_at ASC').all() as any[];
    return rows.map(r => this.rowToModel(r));
  }

  getById(id: string): PipeSource | null {
    const row = db.prepare('SELECT * FROM radio_pipe_streams WHERE id = ?').get(id) as any;
    return row ? this.rowToModel(row) : null;
  }

  async create(data: Omit<PipeSource, 'id' | 'createdAt'>): Promise<PipeSource> {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO radio_pipe_streams (id, name, type, url, reconnect, reconnect_streamed, reconnect_at_eof, reconnect_delay_max, idle_threshold, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.type, data.url,
      data.reconnect ? 1 : 0, data.reconnectStreamed ? 1 : 0, data.reconnectAtEof ? 1 : 0,
      data.reconnectDelayMax, data.idleThreshold, data.enabled ? 1 : 0
    );

    const pipe = this.getById(id)!;
    await configService.addStreamSource(buildSourceUri(pipe));

    if (pipe.type === 'radio') {
      await this.writeRadioServiceFile(pipe);
      await this.run(`${this.SUDO}systemctl daemon-reload`);
      if (pipe.enabled) {
        await this.run(`${this.SUDO}systemctl enable ${getSystemdServiceName(pipe.name)}`).catch(() => {});
        await this.run(`${this.SUDO}systemctl start ${getSystemdServiceName(pipe.name)}`).catch(() => {});
      }
    } else {
      await this.writeMpdOutput(pipe.name, getFifoPath(pipe.name));
      await this.run(`${this.SUDO}systemctl restart mpd`).catch(() => {});
    }

    return pipe;
  }

  async update(id: string, data: Partial<Omit<PipeSource, 'id' | 'createdAt'>>): Promise<PipeSource> {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Pipe source ${id} not found`);

    const oldName = existing.name;
    const updated: PipeSource = { ...existing, ...data };

    db.prepare(`
      UPDATE radio_pipe_streams
      SET name=?, type=?, url=?, reconnect=?, reconnect_streamed=?, reconnect_at_eof=?, reconnect_delay_max=?, idle_threshold=?, enabled=?
      WHERE id=?
    `).run(
      updated.name, updated.type, updated.url,
      updated.reconnect ? 1 : 0, updated.reconnectStreamed ? 1 : 0, updated.reconnectAtEof ? 1 : 0,
      updated.reconnectDelayMax, updated.idleThreshold, updated.enabled ? 1 : 0,
      id
    );

    const oldFifo = getFifoPath(oldName);
    await configService.removeStreamSourceByFifo(oldFifo);

    if (existing.type === 'radio') {
      await this.run(`${this.SUDO}systemctl stop ${getSystemdServiceName(oldName)}`).catch(() => {});
      if (oldName !== updated.name) {
        await this.run(`${this.SUDO}systemctl disable ${getSystemdServiceName(oldName)}`).catch(() => {});
        await this.run(`${this.SUDO}rm -f ${getServiceFilePath(oldName)}`).catch(() => {});
      }
    } else {
      await this.removeMpdOutput(oldFifo);
    }

    await configService.addStreamSource(buildSourceUri(updated));

    if (updated.type === 'radio') {
      await this.writeRadioServiceFile(updated);
      await this.run(`${this.SUDO}systemctl daemon-reload`);
      if (updated.enabled) {
        await this.run(`${this.SUDO}systemctl enable ${getSystemdServiceName(updated.name)}`).catch(() => {});
        await this.run(`${this.SUDO}systemctl restart ${getSystemdServiceName(updated.name)}`).catch(() => {});
      } else {
        await this.run(`${this.SUDO}systemctl disable ${getSystemdServiceName(updated.name)}`).catch(() => {});
      }
    } else {
      await this.writeMpdOutput(updated.name, getFifoPath(updated.name));
      await this.run(`${this.SUDO}systemctl restart mpd`).catch(() => {});
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) return;

    if (pipe.type === 'radio') {
      await this.run(`${this.SUDO}systemctl stop ${getSystemdServiceName(pipe.name)}`).catch(() => {});
      await this.run(`${this.SUDO}systemctl disable ${getSystemdServiceName(pipe.name)}`).catch(() => {});
      await this.run(`${this.SUDO}rm -f ${getServiceFilePath(pipe.name)}`).catch(() => {});
      await this.run(`${this.SUDO}systemctl daemon-reload`);
    } else {
      await this.removeMpdOutput(getFifoPath(pipe.name));
      await this.run(`${this.SUDO}systemctl restart mpd`).catch(() => {});
    }

    await configService.removeStreamSourceByFifo(getFifoPath(pipe.name));
    db.prepare('DELETE FROM radio_pipe_streams WHERE id = ?').run(id);
  }

  async control(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);
    if (pipe.type === 'radio') {
      await this.run(`${this.SUDO}systemctl ${action} ${getSystemdServiceName(pipe.name)}`);
    } else {
      if (action === 'enable' || action === 'disable') return;
      await this.run(`${this.SUDO}systemctl ${action} mpd`);
    }
  }

  async getStatus(id: string): Promise<string> {
    const pipe = this.getById(id);
    if (!pipe) return 'unknown';
    const svcName = pipe.type === 'radio' ? getSystemdServiceName(pipe.name) : 'mpd';
    try {
      const { stdout } = await execAsync(`systemctl is-active ${svcName}`);
      return stdout.trim();
    } catch (err: any) {
      return err.stdout?.trim() || 'inactive';
    }
  }

  async getLogs(id: string, lines = 100): Promise<string> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);
    const svcName = pipe.type === 'radio' ? getSystemdServiceName(pipe.name) : 'mpd';
    const { stdout } = await execAsync(
      `${this.SUDO}journalctl -u ${svcName} -n ${lines} --no-pager`
    );
    return stdout;
  }

  async getAllStatuses(): Promise<Record<string, string>> {
    const pipes = this.list();
    const results: Record<string, string> = {};
    await Promise.all(pipes.map(async p => {
      results[p.id] = await this.getStatus(p.id);
    }));
    return results;
  }

  async getZombieCount(): Promise<number> {
    try {
      const { stdout } = await execAsync("ps aux | grep defunct | grep -v grep | wc -l");
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  async discover(): Promise<DiscoveredPipe[]> {
    const config = await configService.readServerConfigParsed();
    const sources = config.stream?.source;
    if (!sources) return [];

    const sourceList = Array.isArray(sources) ? (sources as string[]) : [String(sources)];
    const managedFifos = new Set(this.list().map(p => getFifoPath(p.name)));
    const mpdFifos = await this.getMpdFifoPaths();
    const discovered: DiscoveredPipe[] = [];

    for (const src of sourceList) {
      if (!src.startsWith('pipe://')) continue;

      const withoutScheme = src.substring('pipe://'.length);
      const qIdx = withoutScheme.indexOf('?');
      const fifoPath = qIdx === -1 ? withoutScheme : withoutScheme.substring(0, qIdx);

      if (managedFifos.has(fifoPath)) continue;

      const nameMatch = src.match(/[?&]name=([^&]+)/);
      const name = nameMatch ? decodeURIComponent(nameMatch[1]) : path.basename(fifoPath);

      const idleMatch = src.match(/[?&]idle_threshold=(\d+)/);
      const idleThreshold = idleMatch ? parseInt(idleMatch[1]) : 15000;

      const detectedType: PipeSourceType = mpdFifos.has(fifoPath) ? 'mpd' : 'radio';
      const existingService = detectedType === 'radio'
        ? await this.findServiceForFifo(fifoPath).catch(() => null)
        : null;

      discovered.push({ name, fifoPath, sourceUri: src, idleThreshold, detectedType, existingService });
    }

    return discovered;
  }

  private async getMpdFifoPaths(): Promise<Set<string>> {
    const result = new Set<string>();
    try {
      const confPath = await findMpdConf();
      if (!confPath) return result;
      const content = await fs.readFile(confPath, 'utf-8');
      const lines = content.split('\n');
      let inBlock = false;
      let isFifoBlock = false;
      let currentPath = '';
      for (const line of lines) {
        if (/^\s*audio_output\s*\{/.test(line)) {
          inBlock = true; isFifoBlock = false; currentPath = '';
        } else if (inBlock) {
          if (/type\s+"fifo"/.test(line)) isFifoBlock = true;
          const pathMatch = line.match(/path\s+"([^"]+)"/);
          if (pathMatch) currentPath = pathMatch[1]!;
          if (/^\s*\}/.test(line)) {
            if (isFifoBlock && currentPath) result.add(currentPath);
            inBlock = false;
          }
        }
      }
    } catch {}
    return result;
  }

  private async findServiceForFifo(fifoPath: string): Promise<ExistingService | null> {
    const { stdout } = await execAsync(
      `grep -rl "${fifoPath}" /etc/systemd/system/ 2>/dev/null || true`
    );
    const files = stdout.trim().split('\n').filter(f => f.endsWith('.service'));
    if (files.length === 0) return null;

    const filePath = files[0]!;
    const name = path.basename(filePath, '.service');
    const content = await fs.readFile(filePath, 'utf-8');

    const urlMatch = content.match(/-i\s+"?([^\s"]+)"?/);
    const url = urlMatch ? urlMatch[1] : '';
    const reconnect = content.includes('-reconnect 1');
    const reconnectStreamed = content.includes('-reconnect_streamed 1');
    const reconnectAtEof = content.includes('-reconnect_at_eof 1');
    const delayMatch = content.match(/-reconnect_delay_max\s+(\d+)/);
    const reconnectDelayMax = delayMatch ? parseInt(delayMatch[1]) : 30;

    let isActive = false;
    try {
      const { stdout: s } = await execAsync(`systemctl is-active ${name}`);
      isActive = s.trim() === 'active';
    } catch {}

    return { name, filePath, url, reconnect, reconnectStreamed, reconnectAtEof, reconnectDelayMax, isActive };
  }

  async adopt(data: AdoptInput): Promise<PipeSource> {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO radio_pipe_streams (id, name, type, url, reconnect, reconnect_streamed, reconnect_at_eof, reconnect_delay_max, idle_threshold, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.type, data.url,
      data.reconnect ? 1 : 0, data.reconnectStreamed ? 1 : 0, data.reconnectAtEof ? 1 : 0,
      data.reconnectDelayMax, data.idleThreshold, data.enabled ? 1 : 0
    );

    const pipe = this.getById(id)!;

    if (data.type === 'radio') {
      if (data.existingServiceName) {
        await this.run(`${this.SUDO}systemctl stop ${data.existingServiceName}`).catch(() => {});
        await this.run(`${this.SUDO}systemctl disable ${data.existingServiceName}`).catch(() => {});
        await this.run(`${this.SUDO}rm -f /etc/systemd/system/${data.existingServiceName}.service`).catch(() => {});
      }
      await this.writeRadioServiceFile(pipe);
      await this.run(`${this.SUDO}systemctl daemon-reload`);
      if (pipe.enabled) {
        await this.run(`${this.SUDO}systemctl enable ${getSystemdServiceName(pipe.name)}`).catch(() => {});
        await this.run(`${this.SUDO}systemctl start ${getSystemdServiceName(pipe.name)}`).catch(() => {});
      }
    }
    // MPD: audio_output already in mpd.conf — no changes needed

    // Source already in snapserver config — do NOT call addStreamSource
    return pipe;
  }

  private async writeRadioServiceFile(pipe: PipeSource): Promise<void> {
    const tmp = `/tmp/snapcast-radio-${hyphenSlug(pipe.name)}.service.tmp`;
    await fs.writeFile(tmp, buildRadioServiceContent(pipe), 'utf-8');
    await this.run(`${this.SUDO}mv ${tmp} ${getServiceFilePath(pipe.name)}`);
    await this.run(`${this.SUDO}chmod 644 ${getServiceFilePath(pipe.name)}`);
  }

  private async writeMpdOutput(name: string, fifoPath: string): Promise<void> {
    const confPath = await findMpdConf();
    if (!confPath) throw new Error('mpd.conf not found — is MPD installed?');
    const content = await fs.readFile(confPath, 'utf-8');
    const cleaned = removeMpdOutputBlock(content, fifoPath);
    const newContent = cleaned.trimEnd() + buildMpdAudioOutputBlock(name, fifoPath) + '\n';
    const tmp = `/tmp/mpd_conf_snapmgr.tmp`;
    await fs.writeFile(tmp, newContent, 'utf-8');
    await this.run(`${this.SUDO}mv ${tmp} ${confPath}`);
    await this.run(`${this.SUDO}chmod 640 ${confPath}`).catch(() => {});
  }

  private async removeMpdOutput(fifoPath: string): Promise<void> {
    const confPath = await findMpdConf();
    if (!confPath) return;
    const content = await fs.readFile(confPath, 'utf-8');
    const newContent = removeMpdOutputBlock(content, fifoPath);
    if (newContent === content) return;
    const tmp = `/tmp/mpd_conf_snapmgr.tmp`;
    await fs.writeFile(tmp, newContent, 'utf-8');
    await this.run(`${this.SUDO}mv ${tmp} ${confPath}`);
  }
}

export const pipeSourceService = new PipeSourceService();
