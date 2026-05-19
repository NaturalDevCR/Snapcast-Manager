import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

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
  status: string;
  fifoPath: string;
  serviceName: string;
}

export type PipeSourceFormData = Omit<PipeSource, 'id' | 'createdAt' | 'status' | 'fifoPath' | 'serviceName'>;

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

export interface AdoptInput extends PipeSourceFormData {
  existingServiceName?: string;
}

export const usePipeSourcesStore = defineStore('pipeSources', () => {
  const pipes = ref<PipeSource[]>([]);
  const loading = ref(false);
  const zombieCount = ref<number | null>(null);

  async function fetchPipes() {
    loading.value = true;
    try {
      pipes.value = await fetchApi<PipeSource[]>('/pipe-sources');
    } finally {
      loading.value = false;
    }
  }

  async function createPipe(data: PipeSourceFormData): Promise<PipeSource> {
    const pipe = await fetchApi<PipeSource>('/pipe-sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await fetchPipes();
    return pipe;
  }

  async function updatePipe(id: string, data: Partial<PipeSourceFormData>): Promise<PipeSource> {
    const pipe = await fetchApi<PipeSource>(`/pipe-sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await fetchPipes();
    return pipe;
  }

  async function deletePipe(id: string): Promise<void> {
    await fetchApi(`/pipe-sources/${id}`, { method: 'DELETE' });
    await fetchPipes();
  }

  async function controlPipe(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    await fetchApi(`/pipe-sources/${id}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    await fetchPipes();
  }

  async function regenerateService(id: string): Promise<void> {
    await fetchApi(`/pipe-sources/${id}/regenerate`, { method: 'POST' });
    await fetchPipes();
  }

  async function getLogs(id: string): Promise<string> {
    const { logs } = await fetchApi<{ logs: string }>(`/pipe-sources/${id}/logs`);
    return logs;
  }

  async function fetchZombieCount(): Promise<void> {
    const { count } = await fetchApi<{ count: number }>('/pipe-sources/system/zombies');
    zombieCount.value = count;
  }

  async function discoverPipes(): Promise<DiscoveredPipe[]> {
    return fetchApi<DiscoveredPipe[]>('/pipe-sources/discover');
  }

  async function getConfig(id: string): Promise<{ content: string; filePath: string }> {
    return fetchApi<{ content: string; filePath: string }>(`/pipe-sources/${id}/config`);
  }

  async function setConfig(id: string, content: string): Promise<void> {
    await fetchApi(`/pipe-sources/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async function adoptPipe(data: AdoptInput): Promise<PipeSource> {
    const pipe = await fetchApi<PipeSource>('/pipe-sources/adopt', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await fetchPipes();
    return pipe;
  }

  return {
    pipes, loading, zombieCount,
    fetchPipes, createPipe, updatePipe, deletePipe, controlPipe, getLogs,
    fetchZombieCount, discoverPipes, adoptPipe, getConfig, setConfig, regenerateService,
  };
});
