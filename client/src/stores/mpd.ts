import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export interface MpdSong {
  title: string;
  artist: string;
  album: string;
  file: string;
  duration: string;
}

export interface MpdStatus {
  state: 'play' | 'pause' | 'stop' | 'unknown' | 'offline';
  volume: string;
  repeat: boolean;
  random: boolean;
  single: boolean;
  consume: boolean;
  playlistLength: string;
  elapsed: string;
  duration: string;
  currentSong: MpdSong;
  error?: string;
}

export const useMpdStore = defineStore('mpd', () => {
  const loading = ref(false);
  const error = ref('');
  const status = ref<MpdStatus | null>(null);

  async function fetchStatus() {
    try {
      const data = await fetchApi('/mpd/status');
      status.value = data;
      error.value = data.error || '';
    } catch (err: any) {
      error.value = err.message || 'Failed to fetch MPD status';
      console.error('MpdStore Error:', err);
    }
  }

  async function control(action: 'play' | 'pause' | 'stop' | 'next' | 'previous') {
    loading.value = true;
    try {
      await fetchApi('/mpd/control', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      await fetchStatus(); // Actualiza el estado tras el control
    } catch (err: any) {
      error.value = err.message || 'Failed to control MPD';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function setVolume(volume: number) {
    loading.value = true;
    try {
      await fetchApi('/mpd/volume', {
        method: 'POST',
        body: JSON.stringify({ volume }),
      });
      await fetchStatus();
    } catch (err: any) {
      error.value = err.message || 'Failed to set MPD volume';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    error,
    status,
    fetchStatus,
    control,
    setVolume,
  };
});
