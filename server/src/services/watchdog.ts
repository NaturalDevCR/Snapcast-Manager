import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const WATCHDOGS_CONFIG_DIR = '/etc/snapcast-manager';
const WATCHDOGS_CONFIG_PATH = path.join(WATCHDOGS_CONFIG_DIR, 'watchdogs.json');

export interface Watchdog {
  id: string;
  name: string;
  port: number;
  description?: string;
  enabled?: boolean;
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

    const port = watchdog.port;
    try {
      // Using 'ss -t -i -n -a' on Linux. 
      // Filter for source OR destination port matching.
      const { stdout } = await execAsync(`ss -t -i -n -a '( sport = :${port} or dport = :${port} )'`);
      return this.parseSocketStats(stdout);
    } catch (error) {
      console.error(`Failed to get socket stats for port ${port}:`, error);
      // Fallback or rethrow? Let's return empty array if no connections.
      // Wait, if ss fails due to command not found (e.g., Mac), try fallback
      if (process.platform === 'darwin') {
         return this.getFallbackStatsMac(port);
      }
      return [];
    }
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
      const { stdout } = await execAsync(`lsof -i :${port} -n -P`);
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
     const watchdogs = await this.load();
     const watchdog = watchdogs.find(w => w.id === id);
     if (!watchdog) throw new Error('Watchdog not found');

     try {
        // ss -K dst peerIp dport = peerPort
        // Note: ss -K might require root privileges
        await execAsync(`ss -K dst ${peerIp} dport = ${peerPort}`);
        return true;
     } catch (error) {
        console.error(`Failed to kill connection ${peerIp}:${peerPort}:`, error);
        // Fallback or error
        return false;
     }
  }
}
