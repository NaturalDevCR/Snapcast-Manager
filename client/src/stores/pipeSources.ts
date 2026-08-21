import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';
// Task 23: these shapes now come from shared/pipeSources.ts (a single
// definition consumed by both the server's Zod schemas/routes and this
// store) instead of being redeclared here -- see
// server/src/schemas/pipeSources.ts and server/src/routes/pipeSources.ts.
// Re-exported under this module's original local names so every existing
// `import { type PipeSource, ... } from '../stores/pipeSources'` call site
// (e.g. src/views/PipeSources.vue) keeps working unchanged.
import type {
  AdoptPipeSourceInput,
  CreatePipeSourceInput,
  DiscoveredPipe,
  ExistingService,
  PipeSource,
  PipeSourceControlAction,
  PipeSourceType,
} from '@shared/pipeSources';

export type { DiscoveredPipe, ExistingService, PipeSource, PipeSourceType };
export type PipeSourceFormData = CreatePipeSourceInput;
export type AdoptInput = AdoptPipeSourceInput;

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

  async function controlPipe(id: string, action: PipeSourceControlAction): Promise<void> {
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
