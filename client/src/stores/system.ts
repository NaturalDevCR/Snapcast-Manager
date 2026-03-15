import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export const useSystemStore = defineStore('system', () => {
  const loading = ref(false);
  const error = ref('');
  const snapserverStatus = ref('unknown');
  const snapclientStatus = ref('unknown');
  
  const installedPackages = ref({
    snapserver: false,
    snapclient: false,
    ffmpeg: false,
  });

  async function checkStatus(service: 'snapserver' | 'snapclient') {
     try {
       const data = await fetchApi(`/system/status/${service}`);
       if (service === 'snapserver') snapserverStatus.value = data.status;
       else snapclientStatus.value = data.status;
     } catch (err) {
       console.error(err);
     }
  }

  async function checkInstalled(pkg: 'snapserver' | 'snapclient' | 'ffmpeg') {
    try {
      const data = await fetchApi(`/system/installed/${pkg}`);
      installedPackages.value[pkg] = data.installed;
    } catch (err) {
      console.error(err);
    }
  }

  async function controlService(action: 'start' | 'stop' | 'restart' | 'enable' | 'disable', service: 'snapserver' | 'snapclient') {
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

  async function installPackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg') {
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

   async function uninstallPackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg') {
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

  async function refreshAll() {
    loading.value = true;
    await Promise.all([
      checkStatus('snapserver'),
      checkStatus('snapclient'),
      checkInstalled('snapserver'),
      checkInstalled('snapclient'),
      checkInstalled('ffmpeg'),
    ]);
    loading.value = false;
  }

  return { 
    loading, 
    error, 
    snapserverStatus, 
    snapclientStatus, 
    installedPackages, 
    controlService, 
    installPackage, 
    uninstallPackage,
    refreshAll 
  };
});
