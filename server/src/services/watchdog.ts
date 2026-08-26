import fs from 'fs/promises';
import path from 'path';
import { run, needsSudo } from '../platform/exec';

// Exported (Task 60) so services/backup.ts can reuse this exact directory
// as one of its cross-cutting backup sources instead of hardcoding a
// second, potentially-drifting literal path -- same reuse precedent as
// services/snapshot.ts's SNAPSHOTS_DIR (Task 57).
export const WATCHDOGS_CONFIG_DIR = '/etc/snapcast-manager';
const WATCHDOGS_CONFIG_PATH = path.join(WATCHDOGS_CONFIG_DIR, 'watchdogs.json');

export interface Watchdog {
  id: string;
  name: string;
  ports: number[]; // Array of ports
  description?: string;
  enabled?: boolean;
  autoKillDuplicates?: boolean; // Last connection wins automation toggle
}

export interface SocketStat {
  state: string;
  localAddress: string;
  localPort: number;
  peerAddress: string;
  peerPort: number;
  recvQ: number;
  sendQ: number;
  rxBytes?: number;
  txBytes?: number;
}

export class WatchdogService {
  private configPath = WATCHDOGS_CONFIG_PATH;
  private previousStats: Map<string, SocketStat[]> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  // Task 26: resolves once the constructor's initial load()-and-decide pass
  // (see applyAutoCleanupState() below) has run. Nothing in this class
  // depends on it -- addWatchdog/updateWatchdog/deleteWatchdog all await
  // their own save() call, which re-derives state synchronously with no
  // extra load() -- but tests use it to deterministically observe the
  // one-time construction-time decision without polling or a real wait.
  private ready: Promise<void>;

  constructor() {
    this.ready = this.load()
      .then(watchdogs => this.applyAutoCleanupState(watchdogs))
      .catch(error => {
        console.error('Watchdog auto-cleanup initialization error:', error);
      });
  }

  /**
   * Task 26 (Stage 3, item 3.8): the auto-cleanup poll used to run via an
   * unconditional setInterval() started at construction time -- for the
   * entire process lifetime, on every tick, regardless of whether any
   * watchdog was even configured, let alone whether any configured
   * watchdog actually had `enabled && autoKillDuplicates` set (the only
   * combination checkAndCleanupDuplicates() is ever invoked for -- see the
   * interval callback in startAutoCleanup() below, unchanged). That meant
   * a disk read (this.load()) every 4 seconds for the life of the process
   * even with zero qualifying watchdogs.
   *
   * This decides, from a watchdog list already in hand (never a fresh
   * load() call of its own -- see the two call sites below), whether the
   * timer SHOULD be running right now, and starts/stops it accordingly.
   * Both startAutoCleanup() and stopAutoCleanup() are idempotent (their own
   * `if (this.intervalId)` / `if (this.intervalId)` guards), so calling
   * this redundantly is always safe and cheap.
   *
   * Call sites (every point that can change whether a qualifying watchdog
   * exists):
   *   - the constructor above, via load(), so a restart with an
   *     already-qualifying persisted config resumes polling immediately
   *     rather than waiting for the first mutation;
   *   - save() below, which addWatchdog()/updateWatchdog()/deleteWatchdog()
   *     all route through to persist -- and which the bulk
   *     `PUT /api/watchdog/bulk` route (routes/watchdog.ts) also calls
   *     directly -- so this is the single place that covers every mutation
   *     path without needing a separate call in each of them.
   */
  private applyAutoCleanupState(watchdogs: Watchdog[]): void {
    const shouldRun = watchdogs.some(wd => wd.enabled && wd.autoKillDuplicates);
    if (shouldRun) {
      this.startAutoCleanup();
    } else {
      this.stopAutoCleanup();
    }
  }

  async startAutoCleanup() {
    if (this.intervalId) return;
    this.intervalId = setInterval(async () => {
      try {
        const watchdogs = await this.load();
        for (const wd of watchdogs) {
          if (wd.enabled && wd.autoKillDuplicates) {
            await this.checkAndCleanupDuplicates(wd);
          }
        }
      } catch (error) {
        console.error('Watchdog auto-cleanup error:', error);
      }
    }, 4000); // check interval
  }

  /** Task 26: idempotent counterpart to startAutoCleanup() -- stops the poll
   * and clears the handle, matching startAutoCleanup()'s own
   * `if (this.intervalId) return;` idempotent-start guard style. */
  stopAutoCleanup(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkAndCleanupDuplicates(wd: Watchdog) {
    try {
      const currentStats = await this.getStats(wd.id);
      const previous = this.previousStats.get(wd.id) || [];

      const active = currentStats.filter(s => s.state === 'ESTAB');
      
      if (active.length > 1) {
        const activeIds = active.map(s => `${s.peerAddress}:${s.peerPort}`);
        const previousIds = previous.map(s => `${s.peerAddress}:${s.peerPort}`);

        const newConnections = active.filter(s => !previousIds.includes(`${s.peerAddress}:${s.peerPort}`));

        if (newConnections.length > 0) {
          const latest = newConnections[0];
          console.log(`[Watchdog] ${wd.name} NEW connection: ${latest.peerAddress}:${latest.peerPort}. Cleaning older targets.`);

          for (const s of active) {
            if (s.peerAddress !== latest.peerAddress || s.peerPort !== latest.peerPort) {
              await this.killConnection(wd.id, s.peerAddress, s.peerPort);
            }
          }
        }
      }
      this.previousStats.set(wd.id, active);
    } catch (e) {
      // Error fetching stats
    }
  }

  private async ensureConfig(): Promise<string> {
    try {
      await fs.mkdir(WATCHDOGS_CONFIG_DIR, { recursive: true });
      return WATCHDOGS_CONFIG_PATH;
    } catch (error) {
      // Fallback for local development or permission issues
      const localDir = path.join(__dirname, '../../config');
      await fs.mkdir(localDir, { recursive: true });
      return path.join(localDir, 'watchdogs.json');
    }
  }

  async load(): Promise<Watchdog[]> {
    const path = await this.ensureConfig();
    try {
      const data = await fs.readFile(path, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  async save(watchdogs: Watchdog[]): Promise<void> {
    const path = await this.ensureConfig();
    await fs.writeFile(path, JSON.stringify(watchdogs, null, 2), 'utf-8');
    // Task 26: re-derive the auto-cleanup timer's should-it-run state from
    // the array just persisted -- see applyAutoCleanupState()'s docstring
    // for why this single call site covers every mutation entry point
    // (addWatchdog/updateWatchdog/deleteWatchdog, and the bulk-save route).
    this.applyAutoCleanupState(watchdogs);
  }

  async getWatchdogs(): Promise<Watchdog[]> {
    return this.load();
  }

  async addWatchdog(watchdog: Omit<Watchdog, 'id'>): Promise<Watchdog> {
    const watchdogs = await this.load();
    const newWatchdog = {
      ...watchdog,
      id: Date.now().toString(),
      enabled: watchdog.enabled !== undefined ? watchdog.enabled : true
    };
    watchdogs.push(newWatchdog);
    await this.save(watchdogs);
    return newWatchdog;
  }

  async updateWatchdog(id: string, watchdog: Partial<Watchdog>): Promise<Watchdog | null> {
    const watchdogs = await this.load();
    const index = watchdogs.findIndex(w => w.id === id);
    if (index === -1) return null;

    watchdogs[index] = { ...watchdogs[index], ...watchdog };
    await this.save(watchdogs);
    return watchdogs[index];
  }

  async deleteWatchdog(id: string): Promise<boolean> {
    const watchdogs = await this.load();
    const initialLength = watchdogs.length;
    const filtered = watchdogs.filter(w => w.id !== id);
    if (filtered.length === initialLength) return false;
    
    await this.save(filtered);
    return true;
  }

  async getStats(id: string): Promise<SocketStat[]> {
    const watchdogs = await this.load();
    const watchdog = watchdogs.find(w => w.id === id);
    if (!watchdog) throw new Error('Watchdog not found');

    const portStats: SocketStat[] = [];
    // Support backward compatibility or direct access arrays
    const ports = Array.isArray(watchdog.ports) ? watchdog.ports : [(watchdog as any).port || 0].filter(Boolean);

    for (const port of ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      try {
        // The `( sport = :N or dport = :N )` filter expression is `ss`'s OWN
        // filter-expression syntax (parsed by `ss` itself), not a shell
        // feature -- it is a single argv element handed to `ss` via execFile,
        // which never shell-interprets it regardless of content. No sudo:
        // this is a read-only query.
        const { stdout } = await run('ss', ['-t', '-i', '-n', '-a', `( sport = :${port} or dport = :${port} )`]);
        portStats.push(...this.parseSocketStats(stdout));
      } catch (error) {
        if (process.platform === 'darwin') {
           const fallback = await this.getFallbackStatsMac(port);
           portStats.push(...fallback);
        }
      }
    }
    return portStats;
  }

  private parseSocketStats(output: string): SocketStat[] {
    const stats: SocketStat[] = [];
    const lines = output.split('\n');
    let currentSocket: Partial<SocketStat> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Header check
      if (trimmed.startsWith('State')) continue;

      // Main line usually looks like:
      // State      Recv-Q Send-Q Local Address:Port               Peer Address:Port
      // ESTAB      0      0      127.0.0.1:4953                   127.0.0.1:51111
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 5 && (parts[0] === 'ESTAB' || parts[0] === 'LISTEN' || parts[0] === 'TIME-WAIT')) {
         
         if (currentSocket && currentSocket.localAddress) {
            stats.push(currentSocket as SocketStat);
         }

         const local = parts[3].split(':');
         const peer = parts[4].split(':');
         
         currentSocket = {
            state: parts[0],
            recvQ: parseInt(parts[1], 10),
            sendQ: parseInt(parts[2], 10),
            localAddress: local[0],
            localPort: parseInt(local[1], 10),
            peerAddress: peer[0],
            peerPort: parseInt(peer[1], 10)
         };
         
      } else if (currentSocket && trimmed.includes('rx_bytes:')) {
         // Parse internal stats line: e.g., "bbr wscale:7,7 rto:204 rtt:4/1 ato:40 mss:1448 pmtu:1500 rcvmss:1448 advmss:1448 cwnd:10 ssthresh:10 bytes_acked:17 segs_out:3 segs_in:3 data_segs_out:1 data_segs_in:1 rx_bytes:17 send 28.96Mbps rcv_rtt:4 rcv_space:14400 rcv_ssthresh:64000 minrtt:4"
         const rxMatch = trimmed.match(/rx_bytes:(\d+)/);
         const txMatch = trimmed.match(/bytes_acked:(\d+)/) || trimmed.match(/tx_bytes:(\d+)/); // bytes_acked is often tx_bytes equivalent in ss stats

         if (rxMatch) currentSocket.rxBytes = parseInt(rxMatch[1], 10);
         if (txMatch) currentSocket.txBytes = parseInt(txMatch[1], 10);
      }
    }

    if (currentSocket && currentSocket.localAddress) {
      stats.push(currentSocket as SocketStat);
    }

    return stats;
  }

  private async getFallbackStatsMac(port: number): Promise<SocketStat[]> {
    try {
      const { stdout } = await run('lsof', ['-i', `:${port}`, '-n', '-P']);
      return this.parseLsofStats(stdout, port);
    } catch (error) {
       return [];
    }
  }

  private parseLsofStats(output: string, port: number): SocketStat[] {
     const stats: SocketStat[] = [];
     const lines = output.split('\n');

     for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('COMMAND')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 9) continue;

        const nameField = parts[8]; // e.g. "127.0.0.1:4953->127.0.0.1:51111" or "*:4953"
        const state = parts.length > 9 ? parts[9].replace(/[()]/g, '') : 'LISTEN';

        if (nameField.includes('->')) {
           const [local, peer] = nameField.split('->');
           const [localIp, localP] = local.split(':');
           const [peerIp, peerP] = peer.split(':');

           stats.push({
              state: state,
              localAddress: localIp,
              localPort: parseInt(localP, 10),
              peerAddress: peerIp,
              peerPort: parseInt(peerP, 10),
              recvQ: 0,
              sendQ: 0
           });
        } else if (nameField.includes(':')) {
           const [ip, p] = nameField.split(':');
           stats.push({
              state: 'LISTEN',
              localAddress: ip,
              localPort: parseInt(p, 10),
              peerAddress: '*',
              peerPort: 0,
              recvQ: 0,
              sendQ: 0
           });
        }
     }
     return stats;
  }

  async killConnection(id: string, peerIp: string, peerPort: number): Promise<boolean> {
     // These values are passed as argv elements to `ss` — validate strictly
     // even though the route already does (defense in depth).
     if (!/^[0-9a-fA-F.:\[\]]+$/.test(peerIp)) throw new Error('Invalid peer IP');
     if (!Number.isInteger(peerPort) || peerPort < 1 || peerPort > 65535) throw new Error('Invalid peer port');

     const watchdogs = await this.load();
     const watchdog = watchdogs.find(w => w.id === id);
     if (!watchdog) throw new Error('Watchdog not found');

     // Single needsSudo()-gated decision, matching the standard pattern used
     // everywhere else in this codebase (platform/systemd.ts's control(),
     // services/backup.ts, services/system.ts) rather than the original's
     // "always try sudo first, silently fall back to no-sudo on any
     // failure" -- see watchdog.test.ts's header comment / the task report
     // for why the original's blind fallback doesn't buy anything real for
     // this app's actual deployment shape (no ambient capability grant, no
     // passwordless-sudo carve-out for `ss` in scripts/install.sh).
     const argv = ['ss', '-K', 'dst', peerIp, 'dport', '=', String(peerPort)];
     try {
        if (needsSudo()) {
           await run('sudo', argv);
        } else {
           await run(argv[0], argv.slice(1));
        }
        return true;
     } catch (error) {
        console.error(`Failed to kill connection ${peerIp}:${peerPort}:`, error);
        return false;
     }
  }
}
