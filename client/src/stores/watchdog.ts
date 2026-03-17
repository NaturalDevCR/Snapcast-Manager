import { defineStore } from 'pinia';
import { fetchApi } from '../utils/api';

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

export const useWatchdogStore = defineStore('watchdog', {
  state: () => ({
    watchdogs: [] as Watchdog[],
    stats: {} as Record<string, SocketStat[]>,
    loading: false,
    error: null as string | null,
  }),

  actions: {
    async fetchWatchdogs() {
      this.loading = true;
      try {
        const data = await fetchApi<Watchdog[]>('/watchdog');
        this.watchdogs = data;
        this.error = null;
      } catch (err: any) {
        this.error = err.message || 'Failed to fetch watchdogs';
      } finally {
        this.loading = false;
      }
    },

    async addWatchdog(watchdog: Omit<Watchdog, 'id'>) {
      try {
        const newWatchdog = await fetchApi<Watchdog>('/watchdog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(watchdog),
        });
        this.watchdogs.push(newWatchdog);
        return newWatchdog;
      } catch (err: any) {
        throw new Error(err.message || 'Failed to add watchdog');
      }
    },

    async updateWatchdog(id: string, watchdog: Partial<Watchdog>) {
      try {
        const updated = await fetchApi<Watchdog>(`/watchdog/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(watchdog),
        });
        const index = this.watchdogs.findIndex(w => w.id === id);
        if (index !== -1) {
          this.watchdogs[index] = updated;
        }
        return updated;
      } catch (err: any) {
        throw new Error(err.message || 'Failed to update watchdog');
      }
    },

    async bulkUpdateWatchdogs(watchdogs: Watchdog[]) {
      try {
        await fetchApi('/watchdog/bulk', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(watchdogs),
        });
        this.watchdogs = watchdogs;
      } catch (err: any) {
        throw new Error(err.message || 'Failed to bulk update watchdogs');
      }
    },

    async deleteWatchdog(id: string) {
      try {
        await fetchApi(`/watchdog/${id}`, { method: 'DELETE' });
        this.watchdogs = this.watchdogs.filter(w => w.id !== id);
        delete this.stats[id];
      } catch (err: any) {
        throw new Error(err.message || 'Failed to delete watchdog');
      }
    },

    async fetchStats(id: string) {
      try {
        const data = await fetchApi<SocketStat[]>(`/watchdog/${id}/stats`);
        this.stats[id] = data;
      } catch (err: any) {
         console.error(`Failed to fetch stats for watchdog ${id}:`, err);
      }
    },

    async disconnectSocket(id: string, peerIp: string, peerPort: number) {
      try {
        await fetchApi(`/watchdog/${id}/disconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerIp, peerPort }),
        });
        // Refresh stats immediately
        await this.fetchStats(id);
      } catch (err: any) {
        throw new Error(err.message || 'Failed to disconnect socket');
      }
    }
  }
});
