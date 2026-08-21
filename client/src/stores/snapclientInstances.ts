import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';
// Task 23: these shapes now come from shared/snapclientInstances.ts (a
// single definition consumed by both the server's Zod schemas/routes and
// this store) instead of being redeclared here -- see
// server/src/schemas/snapclientInstances.ts and
// server/src/routes/snapclientInstances.ts. Re-exported under this
// module's original local names so existing
// `import { type SnapclientInstance, type AlsaControl } from
// '../stores/snapclientInstances'` call sites (e.g.
// src/views/ClientDashboard.vue) keep working unchanged.
import type {
  AlsaControl,
  AudioDevice,
  CreateSnapclientInstanceInput,
  SnapclientControlAction,
  SnapclientInstance,
  UpdateSnapclientInstanceInput,
} from '@shared/snapclientInstances';

export type { AlsaControl, AudioDevice, SnapclientInstance };

export const useSnapclientInstancesStore = defineStore('snapclientInstances', () => {
  const instances = ref<SnapclientInstance[]>([]);
  const devices = ref<AudioDevice[]>([]);
  const loading = ref(false);
  const loadingMessage = ref('');

  async function fetchInstances() {
    try {
      const data = await fetchApi<{ instances: SnapclientInstance[] }>('/snapclient-instances');
      instances.value = data.instances;
    } catch (err) {
      console.error('Failed to fetch snapclient instances:', err);
    }
  }

  async function fetchDevices() {
    try {
      const data = await fetchApi<{ devices: AudioDevice[] }>('/snapclient-instances/devices');
      devices.value = data.devices;
    } catch (err) {
      console.error('Failed to fetch audio devices:', err);
    }
  }

  async function createInstance(payload: CreateSnapclientInstanceInput): Promise<SnapclientInstance> {
    loading.value = true;
    loadingMessage.value = `Creating instance "${payload.name}"...`;
    try {
      const data = await fetchApi<{ instance: SnapclientInstance }>('/snapclient-instances', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      instances.value.push(data.instance);
      return data.instance;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function updateInstance(id: string, payload: UpdateSnapclientInstanceInput): Promise<SnapclientInstance> {
    loading.value = true;
    loadingMessage.value = 'Updating instance...';
    try {
      const data = await fetchApi<{ instance: SnapclientInstance }>(`/snapclient-instances/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const idx = instances.value.findIndex(i => i.id === id);
      if (idx !== -1) instances.value[idx] = data.instance;
      return data.instance;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function deleteInstance(id: string) {
    loading.value = true;
    loadingMessage.value = 'Deleting instance...';
    try {
      await fetchApi(`/snapclient-instances/${id}`, { method: 'DELETE' });
      instances.value = instances.value.filter(i => i.id !== id);
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function controlInstance(id: string, action: SnapclientControlAction) {
    try {
      const data = await fetchApi<{ message: string; status: string }>(`/snapclient-instances/${id}/${action}`, { method: 'POST' });
      const idx = instances.value.findIndex(i => i.id === id);
      const inst = instances.value[idx];
      if (inst) inst.status = data.status;
    } catch (err) {
      console.error(`Failed to ${action} instance ${id}:`, err);
      throw err;
    }
  }

  async function fetchInstanceLogs(id: string): Promise<string> {
    const data = await fetchApi<{ logs: string }>(`/snapclient-instances/${id}/logs`);
    return data.logs;
  }

  async function fetchAlsaControls(cardId: string): Promise<AlsaControl[]> {
    const data = await fetchApi<{ controls: AlsaControl[] }>(`/snapclient-instances/alsa/${encodeURIComponent(cardId)}`);
    return data.controls;
  }

  async function setAlsaVolume(cardId: string, control: string, percent: number): Promise<void> {
    await fetchApi(`/snapclient-instances/alsa/${encodeURIComponent(cardId)}`, {
      method: 'POST',
      body: JSON.stringify({ control, percent }),
    });
  }

  return {
    instances,
    devices,
    loading,
    loadingMessage,
    fetchInstances,
    fetchDevices,
    createInstance,
    updateInstance,
    deleteInstance,
    controlInstance,
    fetchInstanceLogs,
    fetchAlsaControls,
    setAlsaVolume,
  };
});
