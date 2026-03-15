import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export interface SnapcastClient {
  id: string;
  host: {
    ip: string;
    mac: string;
    name: string;
    os: string;
  };
  config: {
    name: string;
    volume: {
      muted: boolean;
      percent: number;
    };
  };
  connected: boolean;
}

export interface SnapcastStream {
  id: string;
  status: string; // "playing", "idle"
  uri: {
    query: {
      name?: string;
    };
    scheme: string; // "tcp", "pipe", etc.
  };
}

export interface SnapcastGroup {
  id: string;
  name: string;
  clients: SnapcastClient[];
  stream_id: string;
  muted: boolean;
}

export interface SnapcastStatus {
  server: {
    server: {
      version: string;
    };
    groups: SnapcastGroup[];
    streams: SnapcastStream[];
  };
}

export const useSnapcastStore = defineStore('snapcast', () => {
  const status = ref<SnapcastStatus['server'] | null>(null);
  const loading = ref(false);
  const error = ref('');

  async function fetchStatus() {
    loading.value = true;
    error.value = '';
    try {
      const data = await fetchApi('/snapcast/status');
      if (data && data.status) {
          status.value = data.status.server;
      }
    } catch (err: any) {
      console.error('Failed to fetch snapcast status:', err);
      error.value = err.message;
      status.value = null;
    } finally {
      loading.value = false;
    }
  }

  return {
    status,
    loading,
    error,
    fetchStatus
  };
});
