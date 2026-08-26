// Task 62 (Stage 5, item 5.5, part 1/2): self-diagnostics backend.
//
// This is the BACKEND half only -- a diagnostics service + endpoint
// producing a list of findings, each with a machine-actionable repair
// hint. Task 63 (frontend UI) consumes it.
//
// Design mirrors routes/health.ts's `/health/detail` pattern: every
// finding-producing check is independently try/caught in runDiagnostics()
// below, degrading to "no findings from this check" rather than taking
// down the others or the whole endpoint. Unlike `/health/detail` (which
// always reports every check's current state, healthy or not), this
// endpoint only ever returns FINDINGS -- things to fix. A fully healthy
// system returns `{ findings: [] }`.
//
// Every category here reuses an existing, already-reviewed primitive
// rather than reimplementing it:
//   - unmanaged-config wraps pipeSources.ts's `discover()` directly.
//   - orphaned-unit is the reverse direction of pipeSources.ts's private
//     `findServiceForFifo()` (unit -> FIFO instead of FIFO -> unit), using
//     the same /etc/systemd/system/ directory this app already scans.
//   - fifo-no-producer cross-references pipeSources.ts's `list()`/
//     `getAllStatuses()` with a real `fs.stat().isFIFO()` check.
//   - snapserver-down reuses the exact two checks `/health/detail` already
//     performs (`isActive('snapserver.service')`, `snapcastLive.isConnected`
//     via the same try/catch-the-getter discipline health.ts uses), but
//     synthesizes them into ONE finding instead of two raw booleans, and
//     only when something is actually wrong.
//   - port-occupied follows watchdog.ts's `getStats()` `ss`-then-`lsof`
//     querying pattern (argv-array `run()` calls only -- never a shelled
//     string), driven by the REAL current snapserver.conf ports (falling
//     back to constants/defaultConfig.ts's CONFIG_METADATA defaults only
//     when the live config doesn't set a port explicitly -- commented-out
//     lines in snapserver.conf mean "use snapserver's own compiled-in
//     default", which IS that metadata default).
import fs from 'fs/promises';
import { pipeSourceService, getFifoPath, getSystemdServiceName, DiscoveredPipe } from './pipeSources';
import { isActive } from '../platform/systemd';
import { run } from '../platform/exec';
import { configService } from './config';
import { snapcastLive } from './snapcastLive';
import { CONFIG_METADATA } from '../constants/defaultConfig';
import type { SnapServerConfig } from '../utils/snapConfigParser';
import { logger } from '../logger';

const log = logger.child({ component: 'diagnostics' });

export type DiagnosticCategory =
  | 'unmanaged-config'
  | 'orphaned-unit'
  | 'fifo-no-producer'
  | 'snapserver-down'
  | 'port-occupied';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * Describes a repair as DATA the frontend can act on, not code executed
 * server-side automatically. Two honest shapes only:
 *   - `kind: 'endpoint'` -- a real, already-existing REST endpoint (never
 *     one invented for this task) the UI can call, with a suggested
 *     request body when one applies.
 *   - `kind: 'manual'` -- no safe automated repair exists (yet); `instructions`
 *     is admin-facing prose telling them what to do by hand. This is the
 *     honest option, not a placeholder -- see orphaned-unit and (usually)
 *     port-occupied below.
 */
export interface DiagnosticRepairAction {
  label: string;
  kind: 'endpoint' | 'manual';
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint?: string;
  body?: Record<string, unknown>;
  instructions?: string;
}

export interface DiagnosticFinding {
  id: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  message: string;
  repairAction?: DiagnosticRepairAction;
}

const SYSTEMD_UNIT_DIR = '/etc/systemd/system';
// Same naming convention pipeSources.ts's getSystemdServiceName() produces
// (`snapcast-radio-<hyphen-slug>`), matched here against real files on disk.
const RADIO_UNIT_FILENAME_RE = /^snapcast-radio-.+\.service$/;

const SNAPSERVER_UNIT = 'snapserver.service';
// The only existing endpoint that already restarts snapserver itself --
// see routes/system.ts's `POST /service/:action/:service`, mounted at
// /api/system in index.ts. No dedicated snapserver-only restart route
// exists; this generic one already covers it.
const SNAPSERVER_RESTART_ENDPOINT = '/api/system/service/restart/snapserver';

/** Same "never let a synchronous getter throw past a try/catch" discipline
 * routes/health.ts's `safeIsConnected()` uses -- read, don't duplicate its
 * logic differently, just mirror the one-liner locally (health.ts doesn't
 * export it). */
function safeIsConnected(): boolean {
  try {
    return snapcastLive.isConnected;
  } catch {
    return false;
  }
}

/** Slug used for finding ids -- lowercase, non-alphanumeric runs collapsed
 * to a single hyphen, leading/trailing hyphens trimmed. Not the SAME
 * function as pipeSources.ts's private underscoreSlug()/hyphenSlug()
 * (those aren't exported, and finding ids are a display/reference concern
 * of this module, not a FIFO-path/unit-name concern of that one) -- but
 * pipe source names are already guaranteed collision-free after slugging
 * (see assertNoSlugCollision() in pipeSources.ts), so ids built from it
 * stay stable and unique here too. */
function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'unnamed';
}

interface PortListener {
  /** Process name, when the underlying tool could report one. `undefined`
   * means "something is listening but we couldn't identify what" (e.g.
   * `ss -p` without permission to see other users' sockets) -- treated as
   * inconclusive, never guessed at, by checkPortOccupied() below. */
  process?: string;
}

/** True iff `name` plausibly refers to snapserver itself. Checked both
 * directions to tolerate `lsof`'s COMMAND column truncation (commonly to 9
 * characters, e.g. "snapserve"). */
function isSnapserverProcessName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('snapserv') || 'snapserver'.includes(lower);
}

function parseSsListenLines(output: string): PortListener[] {
  const listeners: PortListener[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('State')) continue;
    if (!trimmed.startsWith('LISTEN')) continue;
    const match = trimmed.match(/users:\(\("([^"]+)"/);
    listeners.push({ process: match ? match[1] : undefined });
  }
  return listeners;
}

function parseLsofListenLines(output: string): PortListener[] {
  const listeners: PortListener[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('COMMAND')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length === 0 || !parts[0]) continue;
    listeners.push({ process: parts[0] });
  }
  return listeners;
}

export class DiagnosticsService {
  async runDiagnostics(): Promise<DiagnosticFinding[]> {
    const results = await Promise.all([
      this.checkUnmanagedConfig().catch(err => {
        log.error({ err }, 'unmanaged-config diagnostic check failed');
        return [] as DiagnosticFinding[];
      }),
      this.checkOrphanedUnits().catch(err => {
        log.error({ err }, 'orphaned-unit diagnostic check failed');
        return [] as DiagnosticFinding[];
      }),
      this.checkFifoNoProducer().catch(err => {
        log.error({ err }, 'fifo-no-producer diagnostic check failed');
        return [] as DiagnosticFinding[];
      }),
      this.checkSnapserverDown().catch(err => {
        log.error({ err }, 'snapserver-down diagnostic check failed');
        return [] as DiagnosticFinding[];
      }),
      this.checkPortOccupied().catch(err => {
        log.error({ err }, 'port-occupied diagnostic check failed');
        return [] as DiagnosticFinding[];
      }),
    ]);
    return results.flat();
  }

  // ---- 1. unmanaged config -- wraps pipeSources.discover() ----
  private async checkUnmanagedConfig(): Promise<DiagnosticFinding[]> {
    const discovered = await pipeSourceService.discover();
    return discovered.map(d => this.buildUnmanagedConfigFinding(d));
  }

  private buildUnmanagedConfigFinding(d: DiscoveredPipe): DiagnosticFinding {
    const id = `unmanaged-config-${slugify(d.name)}`;
    if (d.existingService) {
      return {
        id,
        category: 'unmanaged-config',
        severity: 'warning',
        message:
          `Pipe source "${d.name}" (${d.fifoPath}) is present in snapserver.conf but not tracked by this app. ` +
          `An existing systemd unit "${d.existingService.name}.service" was found for it and can be adopted.`,
        repairAction: {
          label: 'Adopt this pipe source',
          kind: 'endpoint',
          method: 'POST',
          endpoint: '/api/pipe-sources/adopt',
          body: {
            name: d.name,
            type: d.detectedType,
            url: d.existingService.url,
            reconnect: d.existingService.reconnect,
            reconnectStreamed: d.existingService.reconnectStreamed,
            reconnectAtEof: d.existingService.reconnectAtEof,
            reconnectDelayMax: d.existingService.reconnectDelayMax,
            idleThreshold: d.idleThreshold,
            enabled: d.existingService.isActive,
            existingServiceName: d.existingService.name,
          },
        },
      };
    }

    return {
      id,
      category: 'unmanaged-config',
      severity: 'warning',
      message:
        `Pipe source "${d.name}" (${d.fifoPath}) is present in snapserver.conf but not tracked by this app, ` +
        'and no matching systemd unit was found on disk. Adoption is not possible -- creating a NEW pipe ' +
        'source with a matching name/FIFO is the path to bring it under management.',
      repairAction: {
        label: 'Create a matching pipe source',
        kind: 'endpoint',
        method: 'POST',
        endpoint: '/api/pipe-sources',
        body: {
          name: d.name,
          type: d.detectedType,
          idleThreshold: d.idleThreshold,
        },
      },
    };
  }

  // ---- 2. orphaned units -- reverse of findServiceForFifo() ----
  private async checkOrphanedUnits(): Promise<DiagnosticFinding[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(SYSTEMD_UNIT_DIR);
    } catch {
      // Directory doesn't exist (e.g. a non-systemd dev machine) -- nothing
      // to scan, not an error.
      return [];
    }

    const managedUnitFiles = new Set(
      pipeSourceService.list().map(p => `${getSystemdServiceName(p.name)}.service`),
    );

    const findings: DiagnosticFinding[] = [];
    for (const entry of entries) {
      if (!RADIO_UNIT_FILENAME_RE.test(entry)) continue;
      if (managedUnitFiles.has(entry)) continue;

      const bareUnit = entry.replace(/\.service$/, '');
      findings.push({
        id: `orphaned-unit-${bareUnit}`,
        category: 'orphaned-unit',
        severity: 'warning',
        message:
          `Systemd unit "${entry}" exists in ${SYSTEMD_UNIT_DIR} but does not correspond to any pipe source ` +
          'this app currently tracks.',
        repairAction: {
          label: 'Review and remove manually',
          kind: 'manual',
          instructions:
            `No safe automated repair exists for an orphaned unit -- deleting a systemd unit file is ` +
            `destructive and requires root. Review "${SYSTEMD_UNIT_DIR}/${entry}" and, if it is confirmed ` +
            `unused, stop/disable it (systemctl stop ${bareUnit}; systemctl disable ${bareUnit}) and delete ` +
            'the file by hand.',
        },
      });
    }
    return findings;
  }

  // ---- 3. FIFO without producer ----
  private async checkFifoNoProducer(): Promise<DiagnosticFinding[]> {
    const pipes = pipeSourceService.list();
    const statuses = await pipeSourceService.getAllStatuses();

    const findings: DiagnosticFinding[] = [];
    for (const pipe of pipes) {
      const fifoPath = getFifoPath(pipe.name);
      let stat;
      try {
        stat = await fs.stat(fifoPath);
      } catch {
        continue; // FIFO not present on disk -- not this check's concern
      }
      if (!stat.isFIFO()) continue;

      const status = statuses[pipe.id];
      if (status === 'active') continue; // producer running -- healthy

      findings.push({
        id: `fifo-no-producer-${slugify(pipe.name)}`,
        category: 'fifo-no-producer',
        severity: 'warning',
        message:
          `FIFO "${fifoPath}" for pipe source "${pipe.name}" exists on disk, but its systemd unit is not ` +
          `active (status: ${status ?? 'unknown'}) -- nothing is currently producing audio into it.`,
        repairAction: {
          label: 'Start this pipe source',
          kind: 'endpoint',
          method: 'POST',
          endpoint: `/api/pipe-sources/${pipe.id}/control`,
          body: { action: 'start' },
        },
      });
    }
    return findings;
  }

  // ---- 4. snapserver down -- synthesizes /health/detail's own two checks ----
  private async checkSnapserverDown(): Promise<DiagnosticFinding[]> {
    const [systemdActive, rpcConnected] = await Promise.all([
      isActive(SNAPSERVER_UNIT).catch(() => false),
      Promise.resolve().then(() => safeIsConnected()),
    ]);

    if (systemdActive && rpcConnected) return [];

    const problems: string[] = [];
    if (!systemdActive) problems.push(`its systemd unit "${SNAPSERVER_UNIT}" is not active`);
    if (!rpcConnected) problems.push('the live RPC connection to it is not connected');

    return [
      {
        id: 'snapserver-down',
        category: 'snapserver-down',
        severity: 'error',
        message: `Snapserver appears to be down: ${problems.join(' and ')}.`,
        repairAction: {
          label: 'Restart snapserver',
          kind: 'endpoint',
          method: 'POST',
          endpoint: SNAPSERVER_RESTART_ENDPOINT,
        },
      },
    ];
  }

  // ---- 5. occupied ports -- ss/lsof pattern from watchdog.ts, driven by
  // the real configured ports ----
  private async checkPortOccupied(): Promise<DiagnosticFinding[]> {
    const config = await configService.readServerConfigParsed();
    const snapserverActive = await isActive(SNAPSERVER_UNIT).catch(() => false);

    const ports = [
      { section: 'http', label: 'HTTP', port: this.resolvePort(config, 'http', 'port') },
      { section: 'tcp-control', label: 'TCP control', port: this.resolvePort(config, 'tcp-control', 'port') },
      { section: 'tcp-streaming', label: 'TCP streaming', port: this.resolvePort(config, 'tcp-streaming', 'port') },
    ];

    const findings: DiagnosticFinding[] = [];
    for (const { section, label, port } of ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;

      const listeners = await this.getPortListeners(port);

      if (listeners.length === 0) {
        if (snapserverActive) {
          findings.push({
            id: `port-occupied-${section}-${port}`,
            category: 'port-occupied',
            severity: 'warning',
            message:
              `Nothing is listening on port ${port} (${label}), which the current snapserver config ` +
              'specifies, even though snapserver\'s systemd unit is active. This may indicate a stale ' +
              'config change that has not been applied yet.',
            repairAction: {
              label: 'Restart snapserver to apply the current config',
              kind: 'endpoint',
              method: 'POST',
              endpoint: SNAPSERVER_RESTART_ENDPOINT,
            },
          });
        }
        continue;
      }

      const knownSnapserver = listeners.some(l => l.process && isSnapserverProcessName(l.process));
      if (knownSnapserver) continue; // this IS snapserver -- healthy, no finding

      const knownOther = listeners.find(l => l.process && !isSnapserverProcessName(l.process));
      if (!knownOther) continue; // listener present but unidentifiable -- don't guess

      findings.push({
        id: `port-occupied-${section}-${port}`,
        category: 'port-occupied',
        severity: 'warning',
        message:
          `Port ${port} (${label}), which the current snapserver config specifies, is occupied by a ` +
          `different process ("${knownOther.process}"), not snapserver itself.`,
        repairAction: {
          label: 'Manual investigation needed',
          kind: 'manual',
          instructions:
            `Run "lsof -i :${port}" or "ss -tlnp '( sport = :${port} )'" as an administrator to identify ` +
            `and stop the conflicting process, or change snapserver's ${section}.port setting to a free port.`,
        },
      });
    }
    return findings;
  }

  private resolvePort(config: SnapServerConfig, section: string, key: string): number {
    const raw = config[section]?.[key];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw);
    // Live config doesn't set this explicitly (commented-out in
    // snapserver.conf) -- fall back to snapserver's own compiled-in
    // default, as documented in CONFIG_METADATA, NOT a value invented here.
    return CONFIG_METADATA[section]?.[key]?.default as number;
  }

  /**
   * `ss`-first, `lsof`-fallback-on-macOS querying, same shape as
   * watchdog.ts's getStats()/getFallbackStatsMac() -- argv-array run()
   * calls only, never a shelled string. Restricted to LISTEN-state sockets
   * (`-l`) since this check only cares about who, if anyone, is bound to
   * the port -- not established connections through it.
   */
  private async getPortListeners(port: number): Promise<PortListener[]> {
    try {
      const { stdout } = await run('ss', ['-t', '-l', '-n', '-p', `( sport = :${port} )`]);
      return parseSsListenLines(stdout);
    } catch {
      if (process.platform === 'darwin') {
        try {
          const { stdout } = await run('lsof', ['-i', `:${port}`, '-n', '-P']);
          return parseLsofListenLines(stdout);
        } catch {
          return [];
        }
      }
      return [];
    }
  }
}

export const diagnosticsService = new DiagnosticsService();
