import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import db from '../database';
import { configService } from './config';
import { run, needsSudo, ExecError } from '../platform/exec';
import {
  control as systemdControl,
  activeState,
  isActive as systemdIsActive,
  daemonReload,
  logs as systemdLogs,
  assertValidUnitName,
} from '../platform/systemd';
import { installPrivilegedFile, readTextFile } from '../platform/files';

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

// ---- runtime directory (Task 7) ----
// A tmpfs directory this app controls -- unlike /tmp, only root and members
// of the `audio` group can read/write inside it (mode 0770, group audio).
// /run is wiped on every reboot, so this directory (and the FIFOs inside
// it) must be recreated after every boot: the radio unit's ExecStartPre
// below does that for the radio path, and writeMpdOutput()'s
// ensureRuntimeDir() call does it for the mpd path (see that function's
// docstring, and the Task 7 report, for the full reasoning).
const RUNTIME_DIR = '/run/snapcast-manager';

// ---- path helpers (exported for route use) ----
export function getFifoPath(name: string): string {
  return `${RUNTIME_DIR}/snapfifo_${underscoreSlug(name)}`;
}

/**
 * The FIFO path formula THIS APP USED PRIOR TO TASK 7 -- `/tmp/snapfifo_
 * <slug>`, world-writable directory, `mkfifo -m 666`. Deliberately
 * reimplemented here (not derived from the now-changed `getFifoPath()`)
 * so the migration logic in `migrateFifoPaths()` below has a stable,
 * independent way to compute "where would this pipe's FIFO have lived
 * before this upgrade" regardless of any future change to
 * `getFifoPath()` itself. Only ever used for OLD-path detection during
 * migration -- never for creating new FIFOs.
 */
function getOldFifoPath(name: string): string {
  return `/tmp/snapfifo_${underscoreSlug(name)}`;
}

export function getSystemdServiceName(name: string): string {
  return `snapcast-radio-${hyphenSlug(name)}`;
}

function getServiceFilePath(name: string): string {
  return `/etc/systemd/system/${getSystemdServiceName(name)}.service`;
}

/**
 * `getSystemdServiceName()` deliberately returns the BARE unit name (no
 * `.service` suffix) -- that's a public, exported function whose return
 * value is also used as-is in the API response's `serviceName` field (see
 * routes/pipeSources.ts), so its contract can't change here. But
 * `platform/systemd.ts`'s `assertValidUnitName()`/`control()`/
 * `activeState()`/`logs()` all require a full unit name WITH a valid
 * suffix. This appends it for every internal call site that talks to the
 * platform layer, so the bare/full distinction stays in exactly one place.
 */
function toUnit(pipeName: string): string {
  return `${getSystemdServiceName(pipeName)}.service`;
}

// The mpd unit's base name never comes from user input -- it's a fixed
// literal (per Task 6 brief §2: "For mpd, the unit name is a fixed literal
// -- no user input involved"). systemd unit names require a suffix (see
// platform/systemd.ts's assertValidUnitName), so this is 'mpd.service'
// rather than the bare 'mpd' the old shell commands used (systemctl/
// journalctl treat both identically -- `mpd` is shorthand for `mpd.service`).
const MPD_UNIT = 'mpd.service';

/**
 * Removes a systemd unit file this application (or something it just
 * discovered) owns, given the unit's BARE base name (no `.service` suffix
 * -- the same convention `getSystemdServiceName()` and
 * `ExistingService.name` use). Always re-validates the resulting unit name
 * before touching the filesystem (defense in depth -- see
 * platform/systemd.ts's header on why syntax validation alone is not an
 * authorization decision) and always builds the destination path itself
 * from `/etc/systemd/system/<unit>` rather than accepting a path from any
 * caller.
 */
async function removeServiceFile(unitBaseName: string): Promise<void> {
  const unit = `${unitBaseName}.service`;
  assertValidUnitName(unit);
  const filePath = `/etc/systemd/system/${unit}`;
  if (needsSudo()) {
    await run('sudo', ['rm', '-f', filePath]);
  } else {
    await run('rm', ['-f', filePath]);
  }
}

// ---- snapserver source URI ----
function buildSourceUri(pipe: PipeSource): string {
  const fifo = getFifoPath(pipe.name);
  const encodedName = encodeURIComponent(pipe.name);
  return `pipe://${fifo}?name=${encodedName}&codec=pcm&sampleformat=48000:16:2&idle_threshold=${pipe.idleThreshold}&send_silence=true&mode=create`;
}

// ---- radio: systemd service file ----
/**
 * The generated unit has no `User=` directive, so systemd runs it (and
 * every `ExecStartPre=`/`ExecStart=` line in it) as root regardless of
 * what user the Node/Express manager process itself runs as. That's what
 * makes it safe for `ExecStartPre` below to `mkdir`/`chgrp` under `/run` --
 * a directory a non-root manager process typically cannot write to
 * directly -- and to `chgrp audio` the FIFO: both run with root's
 * privileges every time this unit starts, independent of Task 12's
 * (not-yet-built) manager privilege model.
 */
function buildRadioServiceContent(pipe: PipeSource): string {
  // The URL is embedded in a shell ExecStart line run as root by systemd.
  // Routes validate it, but never trust stored data blindly (defense in depth).
  if (/["'`$\\;\n\r\s]/.test(pipe.url)) {
    throw new Error(`Stream URL for "${pipe.name}" contains unsafe characters`);
  }
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
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
Restart=always
RestartSec=5
ExecStartPre=/bin/bash -c 'mkdir -p -m 0770 ${RUNTIME_DIR} && chgrp audio ${RUNTIME_DIR} 2>/dev/null || true; test -p ${fifo} || mkfifo -m 660 ${fifo}; chgrp audio ${fifo} 2>/dev/null || true'
ExecStart=/bin/bash -o pipefail -c '/usr/bin/ffmpeg -hide_banner ${flags} -i "${pipe.url}" -f s16le -ar 48000 -ac 2 - | cat > ${fifo}'
StandardOutput=null
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

// ---- MPD: extract single audio_output block ----
function extractMpdOutputBlock(content: string, fifoPath: string): string {
  const lines = content.split('\n');
  let inBlock = false;
  let blockContainsFifo = false;
  let blockLines: string[] = [];

  for (const line of lines) {
    if (!inBlock) {
      if (/^\s*audio_output\s*\{/.test(line)) {
        inBlock = true;
        blockLines = [line];
        blockContainsFifo = false;
      }
    } else {
      blockLines.push(line);
      if (line.includes(fifoPath)) blockContainsFifo = true;
      if (/^\s*\}/.test(line)) {
        inBlock = false;
        if (blockContainsFifo) return blockLines.join('\n');
        blockLines = [];
      }
    }
  }
  return '';
}

// ---- MPD: audio_output block management ----
const MPD_CONF_PATHS = ['/etc/mpd.conf', '/var/lib/mpd/mpd.conf'];

async function findMpdConf(): Promise<string | null> {
  for (const p of MPD_CONF_PATHS) {
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

/**
 * Task 7, MPD-directory Option (b): best-effort creation of `RUNTIME_DIR`
 * (mode 0770, group `audio`), called from `writeMpdOutput()` below --
 * always BEFORE that function's `mpd.conf` write and every caller's
 * subsequent `systemctl restart mpd` -- so the directory exists by the
 * time MPD (re)starts and creates its own FIFO inside it. MPD's `fifo`
 * audio-output type creates the FIFO itself internally (there is no
 * `ExecStartPre` hook for it, unlike the radio path above); it can only do
 * that if the *directory* already exists and is writable by the `mpd`
 * user/group (typically `mpd:audio` on Debian) by the time it tries.
 *
 * This runs in the Node process rather than depending on Snapcast
 * Manager's OWN systemd unit gaining a `RuntimeDirectory=` directive
 * (Option (a)) -- see the Task 7 report for the full comparison. Short
 * version: Option (a) only helps if the manager is (1) run via systemd at
 * all and (2) reliably started before mpd on every single boot, neither
 * of which this codebase's current (pre-Task-12) privilege/deployment
 * model guarantees; this function runs every time an mpd-type pipe source
 * is written, regardless of how or whether the manager itself is
 * supervised.
 *
 * `mkdir`/`chgrp` go through `platform/exec.ts`'s `run()`, sudo-prefixed
 * exactly like every other privileged write in this file (see
 * `installPrivilegedFile()`) -- this works whether or not the Node process
 * itself happens to run as root. Both commands are best-effort and never
 * throw: a real `mkdir` permission failure here just means MPD's own
 * internal `mkfifo` will also fail later (an MPD-side problem this
 * function has no way to fix either way), and `chgrp audio` failing (no
 * `audio` group on this system, or insufficient privilege) is tolerated
 * the same way the radio unit's `ExecStartPre` tolerates it
 * (`2>/dev/null || true`).
 */
async function ensureRuntimeDir(): Promise<void> {
  const sudo = needsSudo();
  try {
    if (sudo) {
      await run('sudo', ['mkdir', '-p', '-m', '0770', RUNTIME_DIR]);
    } else {
      await run('mkdir', ['-p', '-m', '0770', RUNTIME_DIR]);
    }
  } catch (err) {
    console.warn(`[pipeSources] Could not create ${RUNTIME_DIR}:`, err);
  }
  try {
    if (sudo) {
      await run('sudo', ['chgrp', 'audio', RUNTIME_DIR]);
    } else {
      await run('chgrp', ['audio', RUNTIME_DIR]);
    }
  } catch {
    // 'audio' group may not exist on this system, or we lack privilege to
    // change it -- tolerate, same as the radio unit's ExecStartPre does.
  }
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
      await daemonReload();
      if (pipe.enabled) {
        const unit = toUnit(pipe.name);
        assertValidUnitName(unit);
        await systemdControl(unit, 'enable').catch(() => {});
        await systemdControl(unit, 'start').catch(() => {});
      }
    } else {
      await this.writeMpdOutput(pipe.name, getFifoPath(pipe.name));
      await systemdControl(MPD_UNIT, 'restart').catch(() => {});
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
      const oldBareUnit = getSystemdServiceName(oldName);
      const oldUnit = toUnit(oldName);
      assertValidUnitName(oldUnit);
      await systemdControl(oldUnit, 'stop').catch(() => {});
      if (oldName !== updated.name) {
        await systemdControl(oldUnit, 'disable').catch(() => {});
        await removeServiceFile(oldBareUnit).catch(() => {});
      }
    } else {
      await this.removeMpdOutput(oldFifo);
    }

    await configService.addStreamSource(buildSourceUri(updated));

    if (updated.type === 'radio') {
      await this.writeRadioServiceFile(updated);
      await daemonReload();
      const newUnit = toUnit(updated.name);
      assertValidUnitName(newUnit);
      if (updated.enabled) {
        await systemdControl(newUnit, 'enable').catch(() => {});
        await systemdControl(newUnit, 'restart').catch(() => {});
      } else {
        await systemdControl(newUnit, 'disable').catch(() => {});
      }
    } else {
      await this.writeMpdOutput(updated.name, getFifoPath(updated.name));
      await systemdControl(MPD_UNIT, 'restart').catch(() => {});
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) return;

    if (pipe.type === 'radio') {
      const bareUnit = getSystemdServiceName(pipe.name);
      const unit = toUnit(pipe.name);
      assertValidUnitName(unit);
      await systemdControl(unit, 'stop').catch(() => {});
      await systemdControl(unit, 'disable').catch(() => {});
      await removeServiceFile(bareUnit).catch(() => {});
      await daemonReload();
    } else {
      await this.removeMpdOutput(getFifoPath(pipe.name));
      await systemdControl(MPD_UNIT, 'restart').catch(() => {});
    }

    await configService.removeStreamSourceByFifo(getFifoPath(pipe.name));
    db.prepare('DELETE FROM radio_pipe_streams WHERE id = ?').run(id);
  }

  async control(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);
    if (pipe.type === 'radio') {
      const unit = toUnit(pipe.name);
      assertValidUnitName(unit);
      await systemdControl(unit, action);
    } else {
      if (action === 'enable' || action === 'disable') return;
      await systemdControl(MPD_UNIT, action);
    }
  }

  async regenerateService(id: string): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);

    if (pipe.type === 'radio') {
      await this.writeRadioServiceFile(pipe);
      await daemonReload();
      const unit = toUnit(pipe.name);
      assertValidUnitName(unit);
      if (pipe.enabled) {
        await systemdControl(unit, 'enable').catch(() => {});
        await systemdControl(unit, 'restart').catch(() => {});
      } else {
        await systemdControl(unit, 'disable').catch(() => {});
      }
      return;
    }

    await this.writeMpdOutput(pipe.name, getFifoPath(pipe.name));
    await systemdControl(MPD_UNIT, 'restart').catch(() => {});
  }

  /**
   * Task 7: automatic, idempotent migration off the old `/tmp/snapfifo_
   * <slug>` FIFO path onto the new `/run/snapcast-manager/snapfifo_<slug>`
   * one, for every existing pipe source in the DB. Called once from
   * index.ts at server startup, but safe to run on every single boot --
   * see `migrateOnePipeFifoPath()`'s detection logic below for why.
   *
   * Design: this function itself NEVER throws. Each pipe's migration is
   * independently wrapped in try/catch; a failure migrating one pipe
   * (a malformed unit file, a permissions error, `mpd.conf` missing, a
   * transient systemctl failure, ...) is logged loudly and then the loop
   * moves on to the next pipe -- it never stops the others and never
   * propagates out of this function. index.ts's call site additionally
   * wraps the whole call in its own try/catch as defense in depth (in case
   * of a bug here that isn't a per-pipe error), but that outer catch is
   * not this function's primary safety mechanism -- the per-pipe try/catch
   * below is.
   */
  async migrateFifoPaths(): Promise<void> {
    const pipes = this.list();
    for (const pipe of pipes) {
      try {
        await this.migrateOnePipeFifoPath(pipe);
      } catch (err) {
        console.error(
          `[pipeSources] FIFO migration FAILED for pipe "${pipe.name}" (${pipe.type}, id=${pipe.id}) -- ` +
          'leaving it on its current path; will retry on next server startup. Error:',
          err,
        );
      }
    }
  }

  /**
   * Detection: does this pipe's ACTUAL on-disk config (the radio unit
   * file, or `mpd.conf`) still reference the OLD `/tmp/snapfifo_<slug>`
   * path? If not -- a fresh install that only ever knew the new path, or a
   * pipe already migrated on a previous boot -- this returns immediately
   * without touching anything, which is what makes `migrateFifoPaths()`
   * idempotent and safe to run on every server startup. A missing file
   * (ENOENT from `readTextFile()`, or no `mpd.conf` found at all) is
   * treated the same as "old path not found" -- there is nothing to
   * migrate if the config this app manages doesn't exist yet.
   */
  private async migrateOnePipeFifoPath(pipe: PipeSource): Promise<void> {
    const oldFifo = getOldFifoPath(pipe.name);
    const newFifo = getFifoPath(pipe.name);

    let stillOnOldPath: boolean;
    if (pipe.type === 'radio') {
      try {
        const content = await readTextFile(getServiceFilePath(pipe.name));
        stillOnOldPath = content.includes(oldFifo);
      } catch {
        stillOnOldPath = false;
      }
    } else {
      const confPath = await findMpdConf();
      if (!confPath) {
        stillOnOldPath = false;
      } else {
        try {
          const content = await readTextFile(confPath);
          stillOnOldPath = content.includes(oldFifo);
        } catch {
          stillOnOldPath = false;
        }
      }
    }

    if (!stillOnOldPath) return;

    console.log(
      `[pipeSources] Migrating pipe "${pipe.name}" (${pipe.type}) FIFO from the old path ${oldFifo} ` +
      `to the new path ${newFifo}...`,
    );

    if (pipe.type === 'radio') {
      // configService.addStreamSource() below builds the URI via
      // buildSourceUri(pipe), which calls getFifoPath() internally --
      // already the NEW path -- so it does not need oldFifo/newFifo passed
      // explicitly.
      await configService.removeStreamSourceByFifo(oldFifo);
      await configService.addStreamSource(buildSourceUri(pipe));
      // regenerateService() rewrites the unit file using the current
      // (new) getFifoPath() and restarts/enables per pipe.enabled.
      await this.regenerateService(pipe.id);
    } else {
      // Order matters for idempotent convergence under a mid-migration
      // failure (Task 7 critical review finding): write the NEW
      // audio_output block first, remove the OLD one second.
      //
      // writeMpdOutput(pipe.name, newFifo) internally calls
      // removeMpdOutputBlock(content, newFifo) before inserting -- i.e. it
      // only strips a pre-existing block matching newFifo (there isn't one
      // yet), never one matching oldFifo. So this call is safe to run
      // while oldFifo's block is still present: it leaves that block
      // completely untouched and appends the new one alongside it.
      //
      // If writeMpdOutput() throws (mpd.conf missing, permission error,
      // disk full, ...), nothing has changed yet -- oldFifo's block is
      // still there, so this function's own detection
      // (`content.includes(oldFifo)`) correctly reports "still needs
      // migration" on the next boot and the per-pipe try/catch in
      // migrateFifoPaths() lets other pipes continue.
      //
      // If writeMpdOutput() succeeds but the subsequent removeMpdOutput()
      // throws, mpd.conf is left with BOTH blocks present -- redundant
      // (MPD may briefly have two fifo outputs for this pipe) but not
      // silently broken: detection still sees oldFifo referenced and will
      // retry the removal on the next boot, eventually converging to just
      // the new block. This is the opposite of the old order, which could
      // leave mpd.conf with NEITHER block (the old one removed, the new
      // one never written) and have detection wrongly conclude "already
      // migrated" forever.
      await this.writeMpdOutput(pipe.name, newFifo);
      await this.removeMpdOutput(oldFifo);
      await systemdControl(MPD_UNIT, 'restart').catch(() => {});
    }

    console.log(`[pipeSources] Migration complete for pipe "${pipe.name}": now using ${newFifo}`);
  }

  async getStatus(id: string): Promise<string> {
    const pipe = this.getById(id);
    if (!pipe) return 'unknown';
    const unit = pipe.type === 'radio' ? toUnit(pipe.name) : MPD_UNIT;
    assertValidUnitName(unit);
    return activeState(unit);
  }

  async getLogs(id: string, lines = 100): Promise<string> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);
    const unit = pipe.type === 'radio' ? toUnit(pipe.name) : MPD_UNIT;
    assertValidUnitName(unit);
    return systemdLogs(unit, lines);
  }

  async getAllStatuses(): Promise<Record<string, string>> {
    const pipes = this.list();
    const results: Record<string, string> = {};
    await Promise.all(pipes.map(async p => {
      results[p.id] = await this.getStatus(p.id);
    }));
    return results;
  }

  /**
   * Counts zombie ("defunct") processes. Out of scope for Task 6's security
   * migration (tracked separately in Stage 3, item 3.9, as a fragility fix
   * via /proc parsing) -- this is a trivial, logic-preserving port of the
   * old `ps aux | grep defunct | grep -v grep | wc -l` shell pipeline onto
   * a single argv-based `run('ps', ['aux'])` call plus in-process line
   * filtering, replacing the shell pipe rather than the counting logic
   * itself. `grep -v grep` in the old pipeline existed only to exclude the
   * `grep defunct` process's own `ps aux` line from matching itself; the
   * `!line.includes('grep')` filter below does the same thing.
   */
  async getZombieCount(): Promise<number> {
    try {
      const { stdout } = await run('ps', ['aux']);
      return stdout.split('\n').filter(line => line.includes('defunct') && !line.includes('grep')).length;
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

  /**
   * Scans /etc/systemd/system/ for a unit file referencing `fifoPath`.
   * `grep -rl` exits 1 when it finds no matching files -- that is the
   * normal "nothing found" outcome, not a real execution failure, so it's
   * caught and treated as an empty result the same way
   * platform/systemd.ts's `activeState()` treats `systemctl is-active`'s
   * non-zero-but-expected exit. Any OTHER failure (grep missing, a real
   * permission error with a different exit code, ...) still propagates --
   * the sole caller (`discover()`) already wraps this in
   * `.catch(() => null)`, so that failure mode is unaffected either way.
   */
  private async findServiceForFifo(fifoPath: string): Promise<ExistingService | null> {
    let stdout: string;
    try {
      const result = await run('grep', ['-rl', fifoPath, '/etc/systemd/system/']);
      stdout = result.stdout;
    } catch (err) {
      if (err instanceof ExecError && err.exitCode === 1) {
        stdout = err.stdout;
      } else {
        throw err;
      }
    }

    const files = stdout.trim().split('\n').filter(f => f.trim().length > 0 && f.endsWith('.service'));
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
      isActive = await systemdIsActive(`${name}.service`);
    } catch {}

    return { name, filePath, url, reconnect, reconnectStreamed, reconnectAtEof, reconnectDelayMax, isActive };
  }

  /**
   * Adopts an unmanaged pipe source discovered via `discover()`.
   *
   * SECURITY: `data.existingServiceName` is caller-supplied (arrives
   * straight from the HTTP request body via routes/pipeSources.ts) and
   * MUST NEVER be trusted on its own -- it used to be interpolated directly
   * into `systemctl stop/disable` and `rm -f` shell commands run as root,
   * which was a real, currently-exploitable command injection (see Task 6
   * brief / design-spec finding #1). It is now only ever used after being
   * matched, byte-for-byte, against a `name` that THIS SERVER just found by
   * independently re-scanning `/etc/systemd/system/` via `discover()` (=>
   * `findServiceForFifo()`) for a real unit file referencing a FIFO path
   * that's both actually present in `snapserver.conf`'s stream sources and
   * not already managed by this app. An attacker-supplied string that
   * doesn't correspond to a real, currently-discoverable, unmanaged unit
   * can never reach `systemdControl()`/`removeServiceFile()` -- the match
   * check below rejects the whole call before any DB row is even created
   * or any privileged command is run.
   */
  async adopt(data: AdoptInput): Promise<PipeSource> {
    let matchedServiceName: string | undefined;

    if (data.type === 'radio' && data.existingServiceName) {
      // Defense in depth: syntax-validate before anything else, even though
      // the discover()-match check below is the actual authorization.
      assertValidUnitName(`${data.existingServiceName}.service`);

      const discovered = await this.discover();
      const match = discovered.find(
        d => d.detectedType === 'radio' && d.existingService?.name === data.existingServiceName,
      );
      if (!match) {
        throw new Error('existingServiceName does not match any discovered, unmanaged pipe service');
      }
      matchedServiceName = data.existingServiceName;
    }

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
      if (matchedServiceName) {
        const oldUnit = `${matchedServiceName}.service`;
        await systemdControl(oldUnit, 'stop').catch(() => {});
        await systemdControl(oldUnit, 'disable').catch(() => {});
        await removeServiceFile(matchedServiceName).catch(() => {});
      }
      await this.writeRadioServiceFile(pipe);
      await daemonReload();
      if (pipe.enabled) {
        const unit = toUnit(pipe.name);
        assertValidUnitName(unit);
        await systemdControl(unit, 'enable').catch(() => {});
        await systemdControl(unit, 'start').catch(() => {});
      }
    }
    // MPD: audio_output already in mpd.conf — no changes needed

    // Source already in snapserver config — do NOT call addStreamSource
    return pipe;
  }

  async getConfigContent(id: string): Promise<{ content: string; filePath: string }> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);

    if (pipe.type === 'radio') {
      const filePath = getServiceFilePath(pipe.name);
      const content = await fs.readFile(filePath, 'utf-8');
      return { content, filePath };
    } else {
      const confPath = await findMpdConf();
      if (!confPath) throw new Error('mpd.conf not found');
      const full = await fs.readFile(confPath, 'utf-8');
      const block = extractMpdOutputBlock(full, getFifoPath(pipe.name));
      return { content: block, filePath: confPath };
    }
  }

  async setConfigContent(id: string, content: string): Promise<void> {
    const pipe = this.getById(id);
    if (!pipe) throw new Error(`Pipe source ${id} not found`);

    if (pipe.type === 'radio') {
      await installPrivilegedFile(getServiceFilePath(pipe.name), content, { mode: 0o644 });
      await daemonReload();
      const unit = toUnit(pipe.name);
      assertValidUnitName(unit);
      await systemdControl(unit, 'restart').catch(() => {});
    } else {
      const confPath = await findMpdConf();
      if (!confPath) throw new Error('mpd.conf not found');
      const full = await fs.readFile(confPath, 'utf-8');
      const fifoPath = getFifoPath(pipe.name);
      const cleaned = removeMpdOutputBlock(full, fifoPath);
      const newContent = cleaned.trimEnd() + '\n\n' + content.trim() + '\n';
      await installPrivilegedFile(confPath, newContent);
      await systemdControl(MPD_UNIT, 'restart').catch(() => {});
    }
  }

  private async writeRadioServiceFile(pipe: PipeSource): Promise<void> {
    await installPrivilegedFile(getServiceFilePath(pipe.name), buildRadioServiceContent(pipe), { mode: 0o644 });
  }

  private async writeMpdOutput(name: string, fifoPath: string): Promise<void> {
    await ensureRuntimeDir();
    const confPath = await findMpdConf();
    if (!confPath) throw new Error('mpd.conf not found — is MPD installed?');
    const content = await fs.readFile(confPath, 'utf-8');
    const cleaned = removeMpdOutputBlock(content, fifoPath);
    const newContent = cleaned.trimEnd() + buildMpdAudioOutputBlock(name, fifoPath) + '\n';
    await installPrivilegedFile(confPath, newContent, { mode: 0o640 });
  }

  private async removeMpdOutput(fifoPath: string): Promise<void> {
    const confPath = await findMpdConf();
    if (!confPath) return;
    const content = await fs.readFile(confPath, 'utf-8');
    const newContent = removeMpdOutputBlock(content, fifoPath);
    if (newContent === content) return;
    await installPrivilegedFile(confPath, newContent);
  }
}

export const pipeSourceService = new PipeSourceService();
