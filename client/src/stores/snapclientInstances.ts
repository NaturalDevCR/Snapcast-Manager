import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export interface SnapclientInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  soundcard: string;
  hostId: string | null;
  instanceNum: number;
  enabled: boolean;
  status: string;
}

export interface AlsaControl {
  name: string;
  percent: number;
}

export interface AudioDevice {
  cardNumber: number;
  cardId: string;
  cardName: string;
  device: number;
  deviceName: string;
  hwId: string;
  label: string;
  inUse: boolean;
}

export const useSnapclientInstancesStore = defineStore('snapclientInstances', () => {
  const instances = ref<SnapclientInstance[]>([]);
  const devices = ref<AudioDevice[]>([]);
  const loading = ref(false);
  const loadingMessage = ref('');

  async function fetchInstances() {
    try {
      const data = await fetchApi('/snapclient-instances');
      instances.value = data.instances;
    } catch (err) {
      console.error('Failed to fetch snapclient instances:', err);
    }
  }

  async function fetchDevices() {
    try {
      const data = await fetchApi('/snapclient-instances/devices');
      devices.value = data.devices;
    } catch (err) {
      console.error('Failed to fetch audio devices:', err);
    }
  }

  async function createInstance(payload: { name: string; host: string; port: number; soundcard: string; hostId?: string }) {
    loading.value = true;
    loadingMessage.value = `Creating instance "${payload.name}"...`;
    try {
      const data = await fetchApi('/snapclient-instances', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      instances.value.push(data.instance);
      return data.instance as SnapclientInstance;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function updateInstance(id: string, payload: Partial<{ name: string; host: string; port: number; soundcard: string; hostId: string }>) {
    loading.value = true;
    loadingMessage.value = 'Updating instance...';
    try {
      const data = await fetchApi(`/snapclient-instances/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const idx = instances.value.findIndex(i => i.id === id);
      if (idx !== -1) instances.value[idx] = data.instance;
      return data.instance as SnapclientInstance;
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

  async function controlInstance(id: string, action: 'start' | 'stop' | 'restart') {
    try {
      const data = await fetchApi(`/snapclient-instances/${id}/${action}`, { method: 'POST' });
      const idx = instances.value.findIndex(i => i.id === id);
      const inst = instances.value[idx];
      if (inst) inst.status = data.status;
    } catch (err) {
      console.error(`Failed to ${action} instance ${id}:`, err);
      throw err;
    }
  }

  async function fetchInstanceLogs(id: string): Promise<string> {
    const data = await fetchApi(`/snapclient-instances/${id}/logs`);
    return data.logs;
  }

  async function fetchAlsaControls(cardId: string): Promise<AlsaControl[]> {
    const data = await fetchApi(`/snapclient-instances/alsa/${encodeURIComponent(cardId)}`);
    return data.controls as AlsaControl[];
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
