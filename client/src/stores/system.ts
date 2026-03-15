import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export const useSystemStore = defineStore('system', () => {
  const loading = ref(false);
  const error = ref('');
  const snapserverStatus = ref('unknown');
  const shairportSyncStatus = ref('unknown');
  
  const installedPackages = ref({
    snapserver: false,
    ffmpeg: false,
    'snap-ctrl': false,
    'shairport-sync': false,
  });

  const packageVersions = ref<Record<string, string>>({
    snapserver: '',
    ffmpeg: '',
    'snap-ctrl': '',
    'shairport-sync': '',
  });

  async function checkStatus(service: 'snapserver' | 'shairport-sync') {
     try {
       const data = await fetchApi(`/system/status/${service}`);
       if (service === 'snapserver') snapserverStatus.value = data.status;
       if (service === 'shairport-sync') shairportSyncStatus.value = data.status;
     } catch (err) {
       console.error(err);
     }
  }

  async function checkInstalled(pkg: 'snapserver' | 'ffmpeg' | 'snap-ctrl' | 'shairport-sync') {
    try {
      const data = await fetchApi(`/system/installed/${pkg}`);
      installedPackages.value[pkg] = data.installed;
    } catch (err) {
      console.error(err);
    }
  }

  async function checkVersion(pkg: string) {
    try {
      const data = await fetchApi(`/system/version/${pkg}`);
      packageVersions.value[pkg] = data.version;
    } catch (err) {
      console.error(err);
    }
  }

  async function controlService(action: 'start' | 'stop' | 'restart' | 'enable' | 'disable', service: 'snapserver' | 'shairport-sync') {
    loading.value = true;
    try {
      await fetchApi(`/system/service/${action}/${service}`, { method: 'POST' });
      await checkStatus(service);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function installPackage(pkg: 'snapserver' | 'ffmpeg' | 'shairport-sync') {
    loading.value = true;
    try {
      await fetchApi(`/system/install/${pkg}`, { method: 'POST' });
      await checkInstalled(pkg);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updatePackage(pkg: 'snapserver' | 'ffmpeg' | 'shairport-sync') {
    loading.value = true;
    try {
      await fetchApi(`/system/update/${pkg}`, { method: 'POST' });
      await checkInstalled(pkg);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function uninstallPackage(pkg: 'snapserver' | 'ffmpeg' | 'shairport-sync') {
    loading.value = true;
    try {
      await fetchApi(`/system/uninstall/${pkg}`, { method: 'POST' });
      await checkInstalled(pkg);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function installSnapCtrl() {
    loading.value = true;
    try {
      await fetchApi(`/system/install-snap-ctrl`, { method: 'POST' });
      await checkInstalled('snap-ctrl');
      await checkStatus('snapserver');
      await checkVersion('snap-ctrl');
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function getLogs(service: string) {
    try {
      const data = await fetchApi(`/system/logs/${service}`);
      return data.logs;
    } catch (err) {
      console.error(err);
      return 'Failed to fetch logs';
    }
  }

  async function fetchServerConfig() {
    try {
      const data = await fetchApi(`/config/server/parsed`);
      return data.config;
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async function saveServerConfig(config: any) {
    loading.value = true;
    try {
      await fetchApi(`/config/server/parsed`, {
        method: 'POST',
        body: JSON.stringify({ config }),
      });
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function refreshAll() {
    loading.value = true;
    await Promise.all([
      checkStatus('snapserver'),
      checkStatus('shairport-sync'),
      checkInstalled('snapserver'),
      checkInstalled('ffmpeg'),
      checkInstalled('snap-ctrl'),
      checkInstalled('shairport-sync'),
      checkVersion('snapserver'),
      checkVersion('ffmpeg'),
      checkVersion('snap-ctrl'),
      checkVersion('shairport-sync'),
    ]);
    loading.value = false;
  }

  return { 
    loading, 
    error, 
    snapserverStatus,
    shairportSyncStatus, 
    installedPackages, 
    packageVersions,
    controlService, 
    installPackage, 
    updatePackage,
    uninstallPackage,
    installSnapCtrl,
    getLogs,
    fetchServerConfig,
    saveServerConfig,
    refreshAll 
  };
});
