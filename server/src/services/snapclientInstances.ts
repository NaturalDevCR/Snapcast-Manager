// Shell-free snapclient-instance management, built on top of
// `platform/exec.ts` / `platform/systemd.ts` / `platform/files.ts` (Tasks
// 4-5, already merged) -- see those files' headers for the shell-free
// contract this module relies on.
//
// SECURITY: `:id` (arrives straight from the URL path via
// routes/snapclientInstances.ts) MUST NEVER be trusted on its own. It used
// to be interpolated directly into `systemctl .../journalctl .../rm ...`
// shell command strings run as root, which was a real, currently-
// exploitable root command injection (`DELETE /api/snapclient-instances/%3B%20rm%20-rf%20%2F%20%23`
// ran `; rm -rf / #` as root -- see the Task 8 brief / design-spec finding
// #2). Every function below that does something privileged with an `id`
// (deleteInstance, controlInstance, getInstanceStatus, getInstanceLogs,
// updateInstance) now calls `getRow(id)` FIRST and bails out (see that
// method's docstring for the chosen not-found convention) BEFORE building
// any unit name or calling any platform function. An attacker-supplied id
// that isn't a real row's id can never reach a systemctl/rm/journalctl
// call -- this is a complete check because these are the app's OWN
// instances, created through its OWN API (unlike Task 6's
// `existingServiceName`, there is no external discovery scan needed here).
// `assertValidUnitName()` is still applied to every derived unit name as
// defense in depth, matching the pattern established in Tasks 6-7.

import { randomUUID } from 'crypto';
import db from '../database';
import { run, needsSudo } from '../platform/exec';
import {
  control as systemdControl,
  activeState,
  daemonReload,
  logs as systemdLogs,
  assertValidUnitName,
} from '../platform/systemd';
import { installPrivilegedFile } from '../platform/files';

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

/** Bare-plus-suffix systemd unit name for a given instance id. */
function unitName(id: string): string {
  return `snapclient-manager-${id}.service`;
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
  /**
   * Resolves `id` against the database FIRST, before any privileged
   * operation builds a unit name from it. Returns the raw DB row, or
   * `null` if no such instance exists.
   *
   * Not-found convention (chosen for this file, applied consistently
   * across all five id-taking functions): return `null` / `false`, never
   * throw. `updateInstance()` already established this convention before
   * this task (`if (!row) return null`); `deleteInstance()` and
   * `controlInstance()` (both previously `Promise<void>`) now return
   * `Promise<boolean>` (`false` = not found) instead, and
   * `getInstanceStatus()`/`getInstanceLogs()` now return `string | null`
   * (`null` = not found). This mirrors the existing, lower-risk contract
   * already in place for `updateInstance()` rather than introducing a new
   * throw-based convention for the other four -- see the Task 8 report for
   * the full rationale and the corresponding route-layer changes (every
   * one of these five now maps its "not found" signal to HTTP 404).
   */
  private getRow(id: string): any | null {
    const row = db.prepare('SELECT * FROM snapclient_instances WHERE id = ?').get(id);
    return row ?? null;
  }

  /** Best-effort `mkdir -p ENV_DIR`, sudo-prefixed via argv when needed. */
  private async ensureEnvDir(): Promise<void> {
    try {
      if (needsSudo()) {
        await run('sudo', ['mkdir', '-p', ENV_DIR]);
      } else {
        await run('mkdir', ['-p', ENV_DIR]);
      }
    } catch (err) {
      console.warn(`[snapclientInstances] Could not create ${ENV_DIR}:`, err);
    }
  }

  private async writeFiles(instance: Omit<SnapclientInstance, 'status'>): Promise<void> {
    await this.ensureEnvDir();
    await installPrivilegedFile(envFileName(instance.id), buildEnvContent(instance), { mode: 0o644 });
    await installPrivilegedFile(serviceFileName(instance.id), buildServiceContent(instance), { mode: 0o644 });
    await daemonReload();
  }

  private async removeFiles(id: string): Promise<void> {
    const sudo = needsSudo();
    const envPath = envFileName(id);
    const svcPath = serviceFileName(id);
    try {
      if (sudo) {
        await run('sudo', ['rm', '-f', envPath]);
      } else {
        await run('rm', ['-f', envPath]);
      }
    } catch {
      // best-effort, matches pre-migration .catch(() => {}) behavior
    }
    try {
      if (sudo) {
        await run('sudo', ['rm', '-f', svcPath]);
      } else {
        await run('rm', ['-f', svcPath]);
      }
    } catch {
      // best-effort, matches pre-migration .catch(() => {}) behavior
    }
    await daemonReload().catch(() => {});
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
      status: (await this.getInstanceStatus(r.id)) ?? 'unknown',
    })));
  }

  async createInstance(data: { name: string; host: string; port: number; soundcard: string; hostId?: string }): Promise<SnapclientInstance> {
    // randomUUID() (Task 8): the previous `inst-${Date.now()}` scheme could
    // collide when two instances were created within the same millisecond,
    // or across a clock change. No migration of existing rows is needed --
    // this only changes what NEW rows get; existing `inst-<timestamp>` ids
    // keep working unchanged (their unit/env files are already named after
    // those ids and nothing here renames existing files).
    const id = randomUUID();
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
    const unit = unitName(id);
    assertValidUnitName(unit);
    await systemdControl(unit, 'enable').catch(() => {});
    await systemdControl(unit, 'start').catch(err => {
      console.warn(`Instance ${id} start warning: ${err.message}`);
    });

    return { ...instance, status: (await this.getInstanceStatus(id)) ?? 'unknown' };
  }

  async updateInstance(id: string, data: Partial<{ name: string; host: string; port: number; soundcard: string; hostId: string }>): Promise<SnapclientInstance | null> {
    const row = this.getRow(id);
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
    const unit = unitName(id);
    assertValidUnitName(unit);
    await systemdControl(unit, 'restart').catch(() => {});

    return { ...updated, status: (await this.getInstanceStatus(id)) ?? 'unknown' };
  }

  /** Returns `false` if `id` does not match a real instance (see `getRow()`), `true` on success. */
  async deleteInstance(id: string): Promise<boolean> {
    const row = this.getRow(id);
    if (!row) return false;

    const unit = unitName(id);
    assertValidUnitName(unit);
    await systemdControl(unit, 'stop').catch(() => {});
    await systemdControl(unit, 'disable').catch(() => {});
    await this.removeFiles(id);
    db.prepare('DELETE FROM snapclient_instances WHERE id = ?').run(id);
    return true;
  }

  /** Returns `false` if `id` does not match a real instance (see `getRow()`), `true` on success. */
  async controlInstance(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<boolean> {
    const row = this.getRow(id);
    if (!row) return false;

    const unit = unitName(id);
    assertValidUnitName(unit);
    await systemdControl(unit, action);
    return true;
  }

  /** Returns `null` if `id` does not match a real instance (see `getRow()`). */
  async getInstanceStatus(id: string): Promise<string | null> {
    const row = this.getRow(id);
    if (!row) return null;

    const unit = unitName(id);
    assertValidUnitName(unit);
    return activeState(unit);
  }

  /**
   * Returns `null` if `id` does not match a real instance (see `getRow()`).
   *
   * `platform/systemd.ts`'s `logs()` already applies `needsSudo()`
   * internally to its `journalctl` call (see that file's `journalctl()`
   * helper) -- the old sudo-then-fallback-without-sudo retry that used to
   * live in this function is therefore unnecessary and has been dropped,
   * not reimplemented on top.
   */
  async getInstanceLogs(id: string): Promise<string | null> {
    const row = this.getRow(id);
    if (!row) return null;

    const unit = unitName(id);
    assertValidUnitName(unit);
    return systemdLogs(unit, 100);
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
      const { stdout } = await run('aplay', ['-l']);
      return this.parseAplayOutput(stdout);
    } catch {
      return [];
    }
  }

  private async getDevicesViaProc(): Promise<AudioDevice[]> {
    try {
      const [pcmResult, cardsResult] = await Promise.all([
        run('cat', ['/proc/asound/pcm']).catch(() => ({ stdout: '', stderr: '' })),
        run('cat', ['/proc/asound/cards']).catch(() => ({ stdout: '', stderr: '' })),
      ]);
      return this.parseProcAsound(pcmResult.stdout, cardsResult.stdout);
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

  /**
   * Validate a card ID / control name to prevent command injection. Kept
   * unchanged by Task 8 (not being replaced) -- it's reasonable input
   * validation on its own, and now also acts purely as an input-shape gate
   * since these values are passed to `platform/exec.ts`'s `run()` as argv
   * elements (no shell in the middle to reinterpret them either way).
   */
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
      const { stdout: raw } = await run('amixer', ['-D', `hw:CARD=${cardId}`, 'scontrols']).catch(() => ({ stdout: '', stderr: '' }));
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
      const { stdout: out } = await run('amixer', ['-D', `hw:CARD=${cardId}`, 'sget', controlName]);
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
    await run('amixer', ['-D', `hw:CARD=${cardId}`, 'sset', controlName, `${pct}%`]);
    // Persist so settings survive reboots
    const sudo = needsSudo();
    try {
      if (sudo) {
        await run('sudo', ['alsactl', 'store']);
      } else {
        await run('alsactl', ['store']);
      }
    } catch {
      // best-effort, matches pre-migration .catch(() => {}) behavior
    }
  }

  // Called after snapclient package install to disable the default service
  async postInstallSetup(): Promise<void> {
    await systemdControl('snapclient.service', 'stop').catch(() => {});
    await systemdControl('snapclient.service', 'disable').catch(() => {});
    await this.ensureEnvDir();
  }
}

export const snapclientInstanceService = new SnapclientInstanceService();
