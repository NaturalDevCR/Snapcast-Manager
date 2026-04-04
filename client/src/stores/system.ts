import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export const useSystemStore = defineStore('system', () => {
  const loading = ref(false);
  const loadingMessage = ref('');
  const error = ref('');
  const snapserverStatus = ref('unknown');
  const snapclientStatus = ref('unknown');
  const shairportSyncStatus = ref('unknown');
  const snapcastMode = ref<'client' | 'server' | 'both'>('both');

  const installedPackages = ref({
    snapserver: false,
    snapclient: false,
    ffmpeg: false,
    'snap-ctrl': false,
    'shairport-sync': false,
    'node': true,
  });

  const packageVersions = ref<Record<string, string>>({
    snapserver: '',
    snapclient: '',
    ffmpeg: '',
    'snap-ctrl': '',
    'shairport-sync': '',
    'node': '',
  });

  const availableVersions = ref<Record<string, string>>({
    snapserver: '',
    snapclient: '',
    ffmpeg: '',
    'snap-ctrl': '',
    'shairport-sync': '',
    'node': '',
  });

  async function checkStatus(service: 'snapserver' | 'snapclient' | 'shairport-sync') {
     try {
       const data = await fetchApi(`/system/status/${service}`);
       if (service === 'snapserver') snapserverStatus.value = data.status;
       if (service === 'snapclient') snapclientStatus.value = data.status;
       if (service === 'shairport-sync') shairportSyncStatus.value = data.status;
     } catch (err) {
       console.error(err);
     }
  }

  async function checkInstalled(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'snap-ctrl' | 'shairport-sync') {
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

  async function checkAvailableVersion(pkg: string) {
    try {
      const data = await fetchApi(`/system/check-updates/${pkg}`);
      availableVersions.value[pkg] = data.version;
    } catch (err) {
      console.error(err);
    }
  }

  async function controlService(action: 'start' | 'stop' | 'restart' | 'enable' | 'disable', service: 'snapserver' | 'snapclient' | 'shairport-sync') {
    const serviceLabel = service === 'snapserver' ? 'Snapserver' : service === 'snapclient' ? 'Snapclient' : 'AirPlay';
    loadingMessage.value = `${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : action === 'restart' ? 'Restarting' : action === 'enable' ? 'Enabling' : 'Disabling'} ${serviceLabel}...`;
    loading.value = true;
    try {
      await fetchApi(`/system/service/${action}/${service}`, { method: 'POST' });
      await checkStatus(service);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function installPackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync') {
    loadingMessage.value = `Installing ${pkg === 'shairport-sync' ? 'Shairport Sync (AirPlay)' : pkg}...`;
    loading.value = true;
    try {
      await fetchApi(`/system/install/${pkg}`, { method: 'POST' });
      await checkInstalled(pkg);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function updatePackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl', clean: boolean = false) {
    loadingMessage.value = `Updating ${pkg === 'shairport-sync' ? 'Shairport Sync (AirPlay 2)' : pkg}... ${pkg === 'shairport-sync' ? '(This takes a few minutes)' : ''}`;
    loading.value = true;
    try {
      await fetchApi(`/system/update/${pkg}`, { 
        method: 'POST',
        body: JSON.stringify({ clean })
      });
      await Promise.all([
          checkInstalled(pkg as any),
          checkVersion(pkg as any),
          checkAvailableVersion(pkg as any)
      ]);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function updateNodeJs(version: string = '20') {
    loading.value = true;
    try {
      await fetchApi(`/system/update-node`, { 
        method: 'POST',
        body: JSON.stringify({ version })
      });
      await checkVersion('node');
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function uninstallPackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync') {
    loadingMessage.value = `Uninstalling ${pkg === 'shairport-sync' ? 'Shairport Sync (AirPlay)' : pkg}...`;
    loading.value = true;
    try {
      await fetchApi(`/system/uninstall/${pkg}`, { method: 'POST' });
      await checkInstalled(pkg);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
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
      loadingMessage.value = '';
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
      loadingMessage.value = '';
    }
  }

  async function fetchMode() {
    try {
      const data = await fetchApi('/status');
      if (data.mode) snapcastMode.value = data.mode;
    } catch (err) {
      console.error('Failed to fetch snapcast mode:', err);
    }
  }

  async function refreshAll() {
    loading.value = true;
    try {
      const data = await fetchApi('/system/dashboard');
      
      if (data.statuses.snapserver) snapserverStatus.value = data.statuses.snapserver;
      if (data.statuses.snapclient) snapclientStatus.value = data.statuses.snapclient;
      if (data.statuses['shairport-sync']) shairportSyncStatus.value = data.statuses['shairport-sync'];
      
      for (const [pkg, isInstalled] of Object.entries(data.installed)) {
         if (pkg in installedPackages.value) {
            installedPackages.value[pkg as keyof typeof installedPackages.value] = isInstalled as boolean;
         }
      }
      
      for (const [pkg, ver] of Object.entries(data.versions)) {
         packageVersions.value[pkg] = ver as string;
      }
      
      for (const [pkg, ver] of Object.entries(data.available)) {
         availableVersions.value[pkg] = ver as string;
      }
    } catch (err) {
      console.error('Failed to refresh dashboard data:', err);
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  return {
    loading,
    loadingMessage,
    error,
    snapserverStatus,
    snapclientStatus,
    shairportSyncStatus,
    snapcastMode,
    installedPackages,
    packageVersions,
    availableVersions,
    controlService,
    installPackage,
    updatePackage,
    uninstallPackage,
    installSnapCtrl,
    updateNodeJs,
    getLogs,
    fetchServerConfig,
    saveServerConfig,
    fetchMode,
    refreshAll
  };
});
