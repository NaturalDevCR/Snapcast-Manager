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
  instanceNum: number;
  enabled: boolean;
  status?: string;
}

export interface AlsaControl {
  name: string;
  percent: number;
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
  // Always set --hostID (user-provided or instance's own unique DB id) so each
  // instance registers as a distinct client on the snapserver even on the same machine.
  // Always set --instance N so the snapserver shows the correct instance number.
  const hostId = instance.hostId || instance.id;
  const opts = `-h ${instance.host} -p ${instance.port} -s ${instance.soundcard} --hostID ${hostId} --instance ${instance.instanceNum}`;
  return `# Snapclient instance: ${instance.name}\nSNAPCLIENT_OPTS="${opts}"\n`;
}

export class SnapclientInstanceService {
  /** Returns 'sudo ' when not root, or '' when already root (e.g. on bare Debian). */
  private get SUDO(): string {
    return (process as any).getuid?.() === 0 ? '' : 'sudo ';
  }

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

    await this.run(`${this.SUDO}mkdir -p ${ENV_DIR}`);
    await this.run(`${this.SUDO}mv ${tmpEnv} ${envFileName(instance.id)}`);
    await this.run(`${this.SUDO}chmod 644 ${envFileName(instance.id)}`);
    await this.run(`${this.SUDO}mv ${tmpSvc} ${serviceFileName(instance.id)}`);
    await this.run(`${this.SUDO}chmod 644 ${serviceFileName(instance.id)}`);
    await this.run(`${this.SUDO}systemctl daemon-reload`);
  }

  private async removeFiles(id: string): Promise<void> {
    await this.run(`${this.SUDO}rm -f ${envFileName(id)}`).catch(() => {});
    await this.run(`${this.SUDO}rm -f ${serviceFileName(id)}`).catch(() => {});
    await this.run(`${this.SUDO}systemctl daemon-reload`).catch(() => {});
  }

  /** Returns the next available sequential instance number. */
  private getNextInstanceNum(): number {
    const result = db.prepare('SELECT MAX(instance_num) as max FROM snapclient_instances').get() as any;
    return (result?.max ?? 0) + 1;
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
      instanceNum: r.instance_num ?? 1,
      enabled: r.enabled === 1,
      status: await this.getInstanceStatus(r.id),
    })));
  }

  async createInstance(data: { name: string; host: string; port: number; soundcard: string; hostId?: string }): Promise<SnapclientInstance> {
    const id = `inst-${Date.now()}`;
    const instanceNum = this.getNextInstanceNum();
    db.prepare(
      'INSERT INTO snapclient_instances (id, name, host, port, soundcard, host_id, instance_num) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.name, data.host, data.port, data.soundcard, data.hostId || null, instanceNum);

    const instance: Omit<SnapclientInstance, 'status'> = {
      id,
      name: data.name,
      host: data.host || '127.0.0.1',
      port: data.port || 1704,
      soundcard: data.soundcard,
      hostId: data.hostId || null,
      instanceNum,
      enabled: true,
    };

    await this.writeFiles(instance);
    await this.run(`${this.SUDO}systemctl enable snapclient-manager-${id}`).catch(() => {});
    await this.run(`${this.SUDO}systemctl start snapclient-manager-${id}`).catch(err => {
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
      instanceNum: row.instance_num ?? 1,
      enabled: row.enabled === 1,
    };

    db.prepare(
      'UPDATE snapclient_instances SET name=?, host=?, port=?, soundcard=?, host_id=? WHERE id=?'
    ).run(updated.name, updated.host, updated.port, updated.soundcard, updated.hostId, id);

    await this.writeFiles(updated);
    await this.run(`${this.SUDO}systemctl restart snapclient-manager-${id}`).catch(() => {});

    return { ...updated, status: await this.getInstanceStatus(id) };
  }

  async deleteInstance(id: string): Promise<void> {
    await this.run(`${this.SUDO}systemctl stop snapclient-manager-${id}`).catch(() => {});
    await this.run(`${this.SUDO}systemctl disable snapclient-manager-${id}`).catch(() => {});
    await this.removeFiles(id);
    db.prepare('DELETE FROM snapclient_instances WHERE id = ?').run(id);
  }

  async controlInstance(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    await this.run(`${this.SUDO}systemctl ${action} snapclient-manager-${id}`);
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
      const cmd = `${this.SUDO}journalctl -u snapclient-manager-${id} -n 100 --no-pager`;
      return await this.run(cmd);
    } catch (err: any) {
      try {
        return await this.run(`journalctl -u snapclient-manager-${id} -n 100 --no-pager`);
      } catch {
        return `Failed to retrieve logs: ${err.message}`;
      }
    }
  }

  /** Returns true if the device is an audio output (not HDMI/SPDIF/DisplayPort). */
  private isAudioOutputDevice(cardName: string, deviceName: string): boolean {
    const nonOutput = /hdmi|displayport|vc4[.\-_]?hdmi|mai\s*pcm|s\/pdif|spdif|iec958|digital\s+output/i;
    return !nonOutput.test(cardName) && !nonOutput.test(deviceName);
  }

  async listAudioDevices(): Promise<AudioDevice[]> {
    // Run both sources in parallel: aplay -l and /proc/asound (readable without audio group)
    const [aplayDevices, procDevices] = await Promise.all([
      this.getDevicesViaAplay(),
      this.getDevicesViaProc(),
    ]);

    // Merge: use aplay as primary, fill in any cards /proc knows about that aplay missed
    const seen = new Set(aplayDevices.map(d => d.hwId));
    const merged = [...aplayDevices];
    for (const d of procDevices) {
      if (!seen.has(d.hwId)) {
        merged.push(d);
        seen.add(d.hwId);
      }
    }

    // Return only real audio output devices (exclude HDMI, SPDIF, DisplayPort, etc.)
    return merged.filter(d => this.isAudioOutputDevice(d.cardName, d.deviceName));
  }

  private async getDevicesViaAplay(): Promise<AudioDevice[]> {
    try {
      const output = await this.run('aplay -l 2>/dev/null');
      return this.parseAplayOutput(output);
    } catch {
      return [];
    }
  }

  private async getDevicesViaProc(): Promise<AudioDevice[]> {
    try {
      const [pcmOutput, cardsOutput] = await Promise.all([
        this.run('cat /proc/asound/pcm 2>/dev/null').catch(() => ''),
        this.run('cat /proc/asound/cards 2>/dev/null').catch(() => ''),
      ]);
      return this.parseProcAsound(pcmOutput, cardsOutput);
    } catch {
      return [];
    }
  }

  /** Parse /proc/asound/cards + /proc/asound/pcm to enumerate all playback devices. */
  private parseProcAsound(pcmOutput: string, cardsOutput: string): AudioDevice[] {
    // Parse cards: " 0 [Headphones     ]: driver - Long Card Name"
    const cardMap: Record<number, { id: string; name: string }> = {};
    const cardLineRegex = /^\s*(\d+)\s+\[(\S+)\s*\]\s*:\s*\S+\s+-\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = cardLineRegex.exec(cardsOutput)) !== null) {
      cardMap[parseInt(m[1])] = { id: m[2].trim(), name: m[3].trim() };
    }

    // Parse PCM: "00-00: Device Name : Device Name : playback N"
    const devices: AudioDevice[] = [];
    const pcmLineRegex = /^(\d+)-(\d+):\s+([^:]+):[^:]+:\s*playback/gm;
    while ((m = pcmLineRegex.exec(pcmOutput)) !== null) {
      const cardNum = parseInt(m[1]);
      const devNum = parseInt(m[2]);
      const deviceName = m[3].trim();
      const card = cardMap[cardNum];
      if (!card) continue;
      const hwId = `hw:CARD=${card.id},DEV=${devNum}`;
      devices.push({
        cardNumber: cardNum,
        cardId: card.id,
        cardName: card.name,
        device: devNum,
        deviceName,
        hwId,
        label: `${card.name} — ${deviceName} (${hwId})`,
      });
    }
    return devices;
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

  // ── ALSA mixer ───────────────────────────────────────────────────────────

  /** Extract the ALSA card short-ID from a hwId string like "hw:CARD=PCH,DEV=0". */
  private cardIdFromHwId(hwId: string): string {
    return hwId.replace(/^hw:CARD=/, '').split(',')[0];
  }

  /** Validate a card ID / control name to prevent command injection. */
  private isValidAlsaId(value: string): boolean {
    return /^[\w\-. ]+$/.test(value);
  }

  /**
   * List all playback volume controls for a given ALSA card short-ID,
   * with their current percentage values.
   */
  async listAlsaControls(cardId: string): Promise<AlsaControl[]> {
    if (!this.isValidAlsaId(cardId)) return [];
    try {
      const raw = await this.run(`amixer -D hw:CARD=${cardId} scontrols 2>/dev/null`).catch(() => '');
      const nameRegex = /Simple mixer control '([^']+)'/g;
      const controls: AlsaControl[] = [];
      let m: RegExpExecArray | null;
      while ((m = nameRegex.exec(raw)) !== null) {
        const name = m[1];
        const percent = await this.getAlsaPercent(cardId, name);
        if (percent !== null) controls.push({ name, percent });
      }
      return controls;
    } catch {
      return [];
    }
  }

  private async getAlsaPercent(cardId: string, controlName: string): Promise<number | null> {
    if (!this.isValidAlsaId(controlName)) return null;
    try {
      const out = await this.run(`amixer -D hw:CARD=${cardId} sget '${controlName}' 2>/dev/null`);
      // Only include controls that have playback volume (pvolume capability or Playback N [X%])
      if (!out.match(/Playback \d+ \[\d+%\]/) && !out.includes('pvolume')) return null;
      const match = out.match(/\[(\d+)%\]/);
      return match ? parseInt(match[1]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Set the volume for a specific ALSA control and persist with alsactl store.
   */
  async setAlsaVolume(cardId: string, controlName: string, percent: number): Promise<void> {
    if (!this.isValidAlsaId(cardId) || !this.isValidAlsaId(controlName)) {
      throw new Error('Invalid cardId or controlName');
    }
    const pct = Math.min(100, Math.max(0, Math.round(percent)));
    await this.run(`amixer -D hw:CARD=${cardId} sset '${controlName}' ${pct}% 2>/dev/null`);
    // Persist so settings survive reboots
    await this.run(`${this.SUDO}alsactl store 2>/dev/null`).catch(() => {});
  }

  // Called after snapclient package install to disable the default service
  async postInstallSetup(): Promise<void> {
    await this.run(`${this.SUDO}systemctl stop snapclient 2>/dev/null || true`).catch(() => {});
    await this.run(`${this.SUDO}systemctl disable snapclient 2>/dev/null || true`).catch(() => {});
    await this.run(`${this.SUDO}mkdir -p ${ENV_DIR}`).catch(() => {});
  }
}

export const snapclientInstanceService = new SnapclientInstanceService();
