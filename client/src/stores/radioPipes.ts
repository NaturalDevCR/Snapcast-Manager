import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export interface RadioPipe {
  id: string;
  name: string;
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

export type RadioPipeFormData = Omit<RadioPipe, 'id' | 'createdAt' | 'status' | 'fifoPath' | 'serviceName'>;

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
  existingService: ExistingService | null;
}

export interface AdoptInput extends RadioPipeFormData {
  existingServiceName?: string;
}

export const useRadioPipesStore = defineStore('radioPipes', () => {
  const pipes = ref<RadioPipe[]>([]);
  const loading = ref(false);
  const zombieCount = ref<number | null>(null);

  async function fetchPipes() {
    loading.value = true;
    try {
      pipes.value = await fetchApi<RadioPipe[]>('/radio-pipes');
    } finally {
      loading.value = false;
    }
  }

  async function createPipe(data: RadioPipeFormData): Promise<RadioPipe> {
    const pipe = await fetchApi<RadioPipe>('/radio-pipes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await fetchPipes();
    return pipe;
  }

  async function updatePipe(id: string, data: Partial<RadioPipeFormData>): Promise<RadioPipe> {
    const pipe = await fetchApi<RadioPipe>(`/radio-pipes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    await fetchPipes();
    return pipe;
  }

  async function deletePipe(id: string): Promise<void> {
    await fetchApi(`/radio-pipes/${id}`, { method: 'DELETE' });
    await fetchPipes();
  }

  async function controlPipe(id: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<void> {
    await fetchApi(`/radio-pipes/${id}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    await fetchPipes();
  }

  async function getLogs(id: string): Promise<string> {
    const { logs } = await fetchApi<{ logs: string }>(`/radio-pipes/${id}/logs`);
    return logs;
  }

  async function fetchZombieCount(): Promise<void> {
    const { count } = await fetchApi<{ count: number }>('/radio-pipes/system/zombies');
    zombieCount.value = count;
  }

  async function discoverPipes(): Promise<DiscoveredPipe[]> {
    return fetchApi<DiscoveredPipe[]>('/radio-pipes/discover');
  }

  async function adoptPipe(data: AdoptInput): Promise<RadioPipe> {
    const pipe = await fetchApi<RadioPipe>('/radio-pipes/adopt', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await fetchPipes();
    return pipe;
  }

  return {
    pipes, loading, zombieCount,
    fetchPipes, createPipe, updatePipe, deletePipe, controlPipe, getLogs, fetchZombieCount,
    discoverPipes, adoptPipe,
  };
});
