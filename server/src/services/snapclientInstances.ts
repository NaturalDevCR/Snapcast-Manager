import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import db from '../database';

const execAsync = util.promisify(exec);

export interface SnapclientInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  soundcard: string;
  hostId: string | null;
  enabled: boolean;
  status?: string;
}

export interface AudioDevice {
  cardNumber: number;
  cardId: string;
  cardName: string;
  device: number;
  deviceName: string;
  hwId: string;
  label: string;
}

const ENV_DIR = '/etc/snapclient-manager';

function serviceFileName(id: string): string {
  return `/etc/systemd/system/snapclient-manager-${id}.service`;
}

function envFileName(id: string): string {
  return `${ENV_DIR}/${id}.env`;
}

function buildServiceContent(instance: Omit<SnapclientInstance, 'status'>): string {
  return `[Unit]
Description=Snapcast client - ${instance.name}
After=network-online.target sound.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${envFileName(instance.id)}
ExecStart=/usr/bin/snapclient $SNAPCLIENT_OPTS
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

function buildEnvContent(instance: Omit<SnapclientInstance, 'status'>): string {
  let opts = `-h ${instance.host} -p ${instance.port} -s ${instance.soundcard}`;
  if (instance.hostId) opts += ` --hostID ${instance.hostId}`;
  return `# Snapclient instance: ${instance.name}\nSNAPCLIENT_OPTS="${opts}"\n`;
}

export class SnapclientInstanceService {
  private async run(cmd: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(cmd);
      if (stderr) console.warn(`[snapclientInstances] stderr: ${stderr}`);
      return stdout;
    } catch (err: any) {
      console.error(`[snapclientInstances] Error: ${cmd}`, err.message);
      throw err;
    }
  }

  private async writeFiles(instance: Omit<SnapclientInstance, 'status'>): Promise<void> {
    const tmpEnv = `/tmp/snapclient-${instance.id}.env`;
    const tmpSvc = `/tmp/snapclient-manager-${instance.id}.service`;

    await fs.writeFile(tmpEnv, buildEnvContent(instance), 'utf-8');
    await fs.writeFile(tmpSvc, buildServiceContent(instance), 'utf-8');

    await this.run(`sudo mkdir -p ${ENV_DIR}`);
    await this.run(`sudo mv ${tmpEnv} ${envFileName(instance.id)}`);
    await this.run(`sudo chmod 644 ${envFileName(instance.id)}`);
    await this.run(`sudo mv ${tmpSvc} ${serviceFileName(instance.id)}`);
    await this.run(`sudo chmod 644 ${serviceFileName(instance.id)}`);
    await this.run('sudo systemctl daemon-reload');
  }

  private async removeFiles(id: string): Promise<void> {
    await this.run(`sudo rm -f ${envFileName(id)}`).catch(() => {});
    await this.run(`sudo rm -f ${serviceFileName(id)}`).catch(() => {});
    await this.run('sudo systemctl daemon-reload').catch(() => {});
  }

  async listInstances(): Promise<SnapclientInstance[]> {
    const rows = db.prepare('SELECT * FROM snapclient_instances ORDER BY created_at ASC').all() as any[];
    return Promise.all(rows.map(async r => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      soundcard: r.soundcard,
      hostId: r.host_id,
      enabled: r.enabled === 1,
      status: await this.getInstanceStatus(r.id),
    })));
  }

  async createInstance(data: { name: string; host: string; port: number; soundcard: string; hostId?: string }): Promise<SnapclientInstance> {
    const id = `inst-${Date.now()}`;
    db.prepare(
      'INSERT INTO snapclient_instances (id, name, host, port, soundcard, host_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, data.name, data.host, data.port, data.soundcard, data.hostId || null);

    const instance: Omit<SnapclientInstance, 'status'> = {
      id,
      name: data.name,
      host: data.host,
      port: data.port,
      soundcard: data.soundcard,
      hostId: data.hostId || null,
      enabled: true,
    };

    await this.writeFiles(instance);
    await this.run(`sudo systemctl enable snapclient-manager-${id}`).catch(() => {});
    await this.run(`sudo systemctl start snapclient-manager-${id}`).catch(err => {
      console.warn(`Instance ${id} start warning: ${err.message}`);
    });

    return { ...instance, status: await this.getInstanceStatus(id) };
  }

  async updateInstance(id: string, data: Partial<{ name: string; host: string; port: number; soundcard: string; hostId: string }>): Promise<SnapclientInstance | null> {
    const row = db.prepare('SELECT * FROM snapclient_instances WHERE id = ?').get(id) as any;
    if (!row) return null;

    const updated: Omit<SnapclientInstance, 'status'> = {
      id,
      name: data.name ?? row.name,
      host: data.host ?? row.host,
      port: data.port ?? row.port,
      soundcard: data.soundcard ?? row.soundcard,
      hostId: data.hostId !== undefined ? data.hostId : row.host_id,
      enabled: row.enabled === 1,
    };

    db.prepare(
      'UPDATE snapclient_instances SET name=?, host=?, port=?, soundcard=?, host_id=? WHERE id=?'
    ).run(updated.name, updated.host, updated.port, updated.soundcard, updated.hostId, id);

    await this.writeFiles(updated);
    await this.run(`sudo systemctl restart snapclient-manager-${id}`).catch(() => {});

    return { ...updated, status: await this.getInstanceStatus(id) };
  }

  async deleteInstance(id: string): Promise<void> {
    await this.run(`sudo systemctl stop snapclient-manager-${id}`).catch(() => {});
    await this.run(`sudo systemctl disable snapclient-manager-${id}`).catch(() => {});
    await this.removeFiles(id);
    db.prepare('DELETE FROM snapclient_instances WHERE id = ?').run(id);
  }

  async controlInstance(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    await this.run(`sudo systemctl ${action} snapclient-manager-${id}`);
  }

  async getInstanceStatus(id: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`systemctl is-active snapclient-manager-${id}`);
      return stdout.trim();
    } catch (err: any) {
      if (err.stdout) return err.stdout.trim();
      return 'inactive';
    }
  }

  async getInstanceLogs(id: string): Promise<string> {
    try {
      let cmd = `sudo journalctl -u snapclient-manager-${id} -n 100 --no-pager`;
      if (process.getuid && process.getuid() === 0) {
        cmd = `journalctl -u snapclient-manager-${id} -n 100 --no-pager`;
      }
      return await this.run(cmd);
    } catch (err: any) {
      try {
        return await this.run(`journalctl -u snapclient-manager-${id} -n 100 --no-pager`);
      } catch {
        return `Failed to retrieve logs: ${err.message}`;
      }
    }
  }

  async listAudioDevices(): Promise<AudioDevice[]> {
    try {
      const output = await this.run('aplay -l 2>/dev/null');
      return this.parseAplayOutput(output);
    } catch {
      return [];
    }
  }

  private parseAplayOutput(output: string): AudioDevice[] {
    const devices: AudioDevice[] = [];
    const cardRegex = /^card (\d+): (\S+) \[([^\]]+)\], device (\d+): [^\[]+\[([^\]]+)\]/gm;
    let match;
    while ((match = cardRegex.exec(output)) !== null) {
      const cardNumber = parseInt(match[1]);
      const cardId = match[2];
      const cardName = match[3].trim();
      const device = parseInt(match[4]);
      const deviceName = match[5].trim();
      const hwId = `hw:CARD=${cardId},DEV=${device}`;
      devices.push({ cardNumber, cardId, cardName, device, deviceName, hwId, label: `${cardName} — ${deviceName} (${hwId})` });
    }
    return devices;
  }

  // Called after snapclient package install to disable the default service
  async postInstallSetup(): Promise<void> {
    await this.run('sudo systemctl stop snapclient 2>/dev/null || true').catch(() => {});
    await this.run('sudo systemctl disable snapclient 2>/dev/null || true').catch(() => {});
    await this.run(`sudo mkdir -p ${ENV_DIR}`).catch(() => {});
  }
}

export const snapclientInstanceService = new SnapclientInstanceService();
