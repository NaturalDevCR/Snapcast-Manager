import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../database';
import { configService } from './config';

const execAsync = util.promisify(exec);

export interface RadioPipe {
  id: string;
  name: string;
  url: string;
  reconnect: boolean;
  reconnectStreamed: boolean;
  reconnectAtEof: boolean;
  reconnectDelayMax: number;
  idleThreshold: number;
  enabled: boolean;
  createdAt: string;
}

export interface RadioPipeWithStatus extends RadioPipe {
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
  existingService: ExistingService | null;
}

export interface AdoptInput extends Omit<RadioPipe, 'id' | 'createdAt'> {
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

// ---- content builders ----
function buildSourceUri(pipe: RadioPipe): string {
  const fifo = getFifoPath(pipe.name);
  const encodedName = encodeURIComponent(pipe.name);
  return `pipe://${fifo}?name=${encodedName}&codec=pcm&sampleformat=48000:16:2&idle_threshold=${pipe.idleThreshold}&send_silence=true&mode=create`;
}

function buildServiceContent(pipe: RadioPipe): string {
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

// ---- service class ----
export class RadioPipeService {
  private get SUDO(): string {
    return (process as any).getuid?.() === 0 ? '' : 'sudo ';
  }

  private async run(cmd: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(cmd);
      if (stderr) console.warn(`[radioPipes] ${stderr.trim()}`);
      return stdout;
    } catch (err: any) {
      console.error(`[radioPipes] cmd failed: ${cmd}`, err.message);
      throw err;
    }
  }

  private rowToModel(row: any): RadioPipe {
    return {
      id: row.id,
      name: row.name,
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

  list(): RadioPipe[] {
    const rows = db.prepare('SELECT * FROM radio_pipe_streams ORDER BY created_at ASC').all() as any[];
    return rows.map(r => this.rowToModel(r));
  }

  getById(id: string): RadioPipe | null {
    const row = db.prepare('SELECT * FROM radio_pipe_streams WHERE id = ?').get(id) as any;
    return row ? this.rowToModel(row) : null;
  }

  async create(data: Omit<RadioPipe, 'id' | 'createdAt'>): Promise<RadioPipe> {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO radio_pipe_streams (id, name, url, reconnect, reconnect_streamed, reconnect_at_eof, reconnect_delay_max, idle_threshold, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.url,
      data.reconnect ? 1 : 0, data.reconnectStreamed ? 1 : 0, data.reconnectAtEof ? 1 : 0,
      data.reconnectDelayMax, data.idleThreshold, data.enabled ? 1 : 0
    );

    const pipe = this.getById(id)!;
    await this.writeServiceFile(pipe);
    await configService.addStreamSource(buildSourceUri(pipe));
    await this.run(`${this.SUDO}systemctl daemon-reload`);

    if (pipe.enabled) {
      await this.run(`${this.SUDO}systemctl enable ${getSystemdServiceName(pipe.name)}`).catch(() => {});
      await this.run(`${this.SUDO}systemctl start ${getSystemdServiceName(pipe.name)}`).catch(() => {});
    }
    return pipe;
  }

  async update(id: string, data: Partial<Omit<RadioPipe, 'id' | 'createdAt'>>): Promise<RadioPipe> {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Radio pipe ${id} not found`);

    const oldName = existing.name;
    const updated: RadioPipe = { ...existing, ...data };

    db.prepare(`
      UPDATE radio_pipe_streams
      SET name=?, url=?, reconnect=?, reconnect_streamed=?, reconnect_at_eof=?, reconnect_delay_max=?, idle_threshold=?, enabled=?
      WHERE id=?
    `).run(
      updated.name, updated.url,
      updated.reconnect ? 1 : 0, updated.reconnectStreamed ? 1 : 0, updated.reconnectAtEof ? 1 : 0,
      updated.reconnectDelayMax, updated.idleThreshold, updated.enabled ? 1 : 0,
      id
    );

    await this.run(`${this.SUDO}systemctl stop ${getSystemdServiceName(oldName)}`).catch(() => {});

    if (oldName !== updated.name) {
      await this.run(`${this.SUDO}systemctl disable ${getSystemdServiceName(oldName)}`).catch(() => {});
      await this.run(`${this.SUDO}rm -f ${getServiceFilePath(oldName)}`).catch(() => {});
    }

    await configService.removeStreamSourceByFifo(getFifoPath(oldName));
    await this.writeServiceFile(updated);
    await configService.addStreamSource(buildSourceUri(updated));
    await this.run(`${this.SUDO}systemctl daemon-reload`);

    if (updated.enabled) {
      await this.run(`${this.SUDO}systemctl enable ${getSystemdServiceName(updated.name)}`).catch(() => {});
      await this.run(`${this.SUDO}systemctl restart ${getSystemdServiceName(updated.name)}`).catch(() => {});
    } else {
      await this.run(`${this.SUDO}systemctl disable ${getSystemdServiceName(updated.name)}`).catch(() => {});
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) return;

    await this.run(`${this.SUDO}systemctl stop ${getSystemdServiceName(pipe.name)}`).catch(() => {});
    await this.run(`${this.SUDO}systemctl disable ${getSystemdServiceName(pipe.name)}`).catch(() => {});
    await this.run(`${this.SUDO}rm -f ${getServiceFilePath(pipe.name)}`).catch(() => {});
    await configService.removeStreamSourceByFifo(getFifoPath(pipe.name));
    await this.run(`${this.SUDO}systemctl daemon-reload`);

    db.prepare('DELETE FROM radio_pipe_streams WHERE id = ?').run(id);
  }

  async control(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Radio pipe ${id} not found`);
    await this.run(`${this.SUDO}systemctl ${action} ${getSystemdServiceName(pipe.name)}`);
  }

  async getStatus(id: string): Promise<string> {
    const pipe = this.getById(id);
    if (!pipe) return 'unknown';
    try {
      const { stdout } = await execAsync(`systemctl is-active ${getSystemdServiceName(pipe.name)}`);
      return stdout.trim();
    } catch (err: any) {
      return err.stdout?.trim() || 'inactive';
    }
  }

  async getLogs(id: string, lines = 100): Promise<string> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Radio pipe ${id} not found`);
    const { stdout } = await execAsync(
      `${this.SUDO}journalctl -u ${getSystemdServiceName(pipe.name)} -n ${lines} --no-pager`
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

      const existingService = await this.findServiceForFifo(fifoPath).catch(() => null);

      discovered.push({ name, fifoPath, sourceUri: src, idleThreshold, existingService });
    }

    return discovered;
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

  async adopt(data: AdoptInput): Promise<RadioPipe> {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO radio_pipe_streams (id, name, url, reconnect, reconnect_streamed, reconnect_at_eof, reconnect_delay_max, idle_threshold, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, data.name, data.url,
      data.reconnect ? 1 : 0, data.reconnectStreamed ? 1 : 0, data.reconnectAtEof ? 1 : 0,
      data.reconnectDelayMax, data.idleThreshold, data.enabled ? 1 : 0
    );

    const pipe = this.getById(id)!;

    if (data.existingServiceName) {
      await this.run(`${this.SUDO}systemctl stop ${data.existingServiceName}`).catch(() => {});
      await this.run(`${this.SUDO}systemctl disable ${data.existingServiceName}`).catch(() => {});
      await this.run(`${this.SUDO}rm -f /etc/systemd/system/${data.existingServiceName}.service`).catch(() => {});
    }

    await this.writeServiceFile(pipe);
    await this.run(`${this.SUDO}systemctl daemon-reload`);

    if (pipe.enabled) {
      await this.run(`${this.SUDO}systemctl enable ${getSystemdServiceName(pipe.name)}`).catch(() => {});
      await this.run(`${this.SUDO}systemctl start ${getSystemdServiceName(pipe.name)}`).catch(() => {});
    }

    // Source already exists in snapserver config — do NOT call addStreamSource
    return pipe;
  }

  private async writeServiceFile(pipe: RadioPipe): Promise<void> {
    const tmp = `/tmp/snapcast-radio-${hyphenSlug(pipe.name)}.service.tmp`;
    await fs.writeFile(tmp, buildServiceContent(pipe), 'utf-8');
    await this.run(`${this.SUDO}mv ${tmp} ${getServiceFilePath(pipe.name)}`);
    await this.run(`${this.SUDO}chmod 644 ${getServiceFilePath(pipe.name)}`);
  }
}

export const radioPipeService = new RadioPipeService();
