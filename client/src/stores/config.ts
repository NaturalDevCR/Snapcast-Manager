import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export const useConfigStore = defineStore('config', () => {
  const loading = ref(false);
  const error = ref('');
  const serverConfig = ref('');
  const serverConfigParsed = ref<any>({});
  const clientConfig = ref<Record<string, string>>({});
  const configSegments = ref<{name: string, content: string}[]>([]);

  async function fetchServerConfig() {
    loading.value = true;
    try {
      const data = await fetchApi('/config/server');
      serverConfig.value = data.content;
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function fetchServerConfigParsed() {
    loading.value = true;
    try {
      const data = await fetchApi('/config/server/parsed');
      serverConfigParsed.value = data.config;
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function updateServerConfig(content: string) {
    loading.value = true;
    try {
      await fetchApi('/config/server', {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      await fetchServerConfig();
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updateServerConfigParsed(config: any) {
    loading.value = true;
    try {
      await fetchApi('/config/server/parsed', {
        method: 'POST',
        body: JSON.stringify({ config }),
      });
      await fetchServerConfigParsed();
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchClientConfig() {
    loading.value = true;
    try {
      const data = await fetchApi('/config/client');
      clientConfig.value = data.config;
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function updateClientConfig(config: Record<string, string>) {
    loading.value = true;
    try {
      await fetchApi('/config/client', {
        method: 'POST',
        body: JSON.stringify({ config }),
      });
      await fetchClientConfig();
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchConfigSegments() {
    loading.value = true;
    try {
      const data = await fetchApi('/config/segments');
      configSegments.value = data;
    } catch (err: any) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function saveConfigSegment(name: string, content: string) {
    loading.value = true;
    try {
      await fetchApi('/config/segments', {
        method: 'POST',
        body: JSON.stringify({ name, content }),
      });
      await fetchConfigSegments();
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteConfigSegment(name: string) {
    loading.value = true;
    try {
      await fetchApi(`/config/segments/${name}`, {
        method: 'DELETE',
      });
      await fetchConfigSegments();
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function rebuildMasterConfig() {
    loading.value = true;
    try {
      await fetchApi('/config/rebuild', {
        method: 'POST',
      });
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return { 
    loading, 
    error, 
    serverConfig, 
    serverConfigParsed,
    clientConfig, 
    fetchServerConfig, 
    fetchServerConfigParsed,
    updateServerConfig, 
    updateServerConfigParsed,
    fetchClientConfig, 
    updateClientConfig,
    configSegments,
    fetchConfigSegments,
    saveConfigSegment,
    deleteConfigSegment,
    rebuildMasterConfig
  };
});
