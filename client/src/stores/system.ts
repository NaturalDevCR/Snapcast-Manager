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
    ]);
    loading.value = false;
  }

  return { 
    loading, 
    error, 
    snapserverStatus,
    shairportSyncStatus, 
    installedPackages, 
    controlService, 
    installPackage, 
    updatePackage,
    uninstallPackage,
    installSnapCtrl,
    refreshAll 
  };
});
