import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { fetchApi } from '../utils/api';

export const useSystemStore = defineStore('system', () => {
  const loading = ref(false);
  const loadingMessage = ref('');
  const error = ref('');
  // Feature request found live: a user asked for a real log window during
  // install/update jobs -- runJob() already polled the job's FULL log
  // array every 2s (server/src/services/jobs.ts already tracks it, pushed
  // over SSE too via jobEvents, see routes/events.ts), but only ever
  // surfaced the single LAST line into `loadingMessage`, overwritten each
  // poll. `jobLog` exposes the full, growing array so a UI panel can show
  // real install/build output as it happens instead of one line that
  // keeps disappearing. Cleared at the start of each new job (below) so a
  // second install doesn't show a stale tail from a previous one.
  const jobLog = ref<string[]>([]);
  const snapserverStatus = ref('unknown');
  const snapclientStatus = ref('unknown');
  const shairportSyncStatus = ref('unknown');
  const mpdStatus = ref('unknown');
  const mympdStatus = ref('unknown');
  const mympdPort = ref(8080);
  const mympdRunning = ref(false);
  const snapcastMode = ref<'client' | 'server' | 'both'>('both');

  const installedPackages = ref({
    snapserver: false,
    snapclient: false,
    ffmpeg: false,
    'snap-ctrl': false,
    'shairport-sync': false,
    'node': true,
    'mpd': false,
    'mympd': false,
  });

  const packageVersions = ref<Record<string, string>>({
    snapserver: '',
    snapclient: '',
    ffmpeg: '',
    'snap-ctrl': '',
    'shairport-sync': '',
    'node': '',
    'mpd': '',
    'mympd': '',
  });

  const availableVersions = ref<Record<string, string>>({
    snapserver: '',
    snapclient: '',
    ffmpeg: '',
    'snap-ctrl': '',
    'shairport-sync': '',
    'node': '',
    'mpd': '',
    'mympd': '',
  });

  async function checkStatus(service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'mpd' | 'mympd') {
     try {
       const data = await fetchApi(`/system/status/${service}`);
       if (service === 'snapserver') snapserverStatus.value = data.status;
       if (service === 'snapclient') snapclientStatus.value = data.status;
       if (service === 'shairport-sync') shairportSyncStatus.value = data.status;
       if (service === 'mpd') mpdStatus.value = data.status;
       if (service === 'mympd') mympdStatus.value = data.status;
     } catch (err) {
       console.error(err);
     }
  }

  async function checkInstalled(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'snap-ctrl' | 'shairport-sync' | 'mpd' | 'mympd') {
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

  /**
   * Starts a background job on the server (install/update tasks) and polls it
   * until completion, surfacing progress lines in the loading overlay. Long
   * tasks like compiling shairport-sync no longer hold an HTTP request open.
   */
  async function runJob(endpoint: string, body: Record<string, unknown> | null, message: string): Promise<void> {
    loadingMessage.value = message;
    jobLog.value = [];
    loading.value = true;
    try {
      const start = await fetchApi(endpoint, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!start.jobId) return; // server handled it synchronously

      while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const job = await fetchApi(`/system/jobs/${start.jobId}`);
        jobLog.value = job.log || [];
        const lastLine = job.log?.length ? job.log[job.log.length - 1] : '';
        loadingMessage.value = lastLine ? `${message} — ${lastLine}` : message;
        if (job.status === 'done') return;
        if (job.status === 'error') throw new Error(job.error || 'Task failed');
      }
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      // jobLog is deliberately NOT cleared here -- the log panel (see
      // JobLogPanel.vue) stays open a moment after `loading` goes false so
      // the user can read the final lines (e.g. "...installed
      // successfully.") instead of it vanishing the instant the job
      // finishes; it's cleared at the START of the next runJob() call
      // above instead.
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function controlService(action: 'start' | 'stop' | 'restart' | 'enable' | 'disable', service: 'snapserver' | 'snapclient' | 'shairport-sync' | 'mpd' | 'mympd') {
    const serviceLabel = service === 'snapserver' ? 'Snapserver' : service === 'snapclient' ? 'Snapclient' : service === 'shairport-sync' ? 'AirPlay' : service === 'mympd' ? 'myMPD' : 'MPD';
    loadingMessage.value = `${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : action === 'restart' ? 'Restarting' : action === 'enable' ? 'Enabling' : 'Disabling'} ${serviceLabel}...`;
    loading.value = true;
    try {
      await fetchApi(`/system/service/${action}/${service}`, { method: 'POST' });
      await checkStatus(service as any);
    } catch (err: any) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
      loadingMessage.value = '';
    }
  }

  async function installPackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'mpd' | 'mympd') {
    const label = pkg === 'shairport-sync' ? 'Shairport Sync (AirPlay)' : pkg === 'mpd' ? 'MPD (Music Player Daemon)' : pkg === 'mympd' ? 'myMPD' : pkg;
    await runJob(`/system/install/${pkg}`, null, `Installing ${label}...`);
    await checkInstalled(pkg);
  }

  async function updatePackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'mpd' | 'mympd', clean: boolean = false) {
    const label = pkg === 'shairport-sync' ? 'Shairport Sync (AirPlay 2)' : pkg === 'mpd' ? 'MPD' : pkg === 'mympd' ? 'myMPD' : pkg;
    await runJob(`/system/update/${pkg}`, { clean }, `Updating ${label}...`);
    await Promise.all([
        checkInstalled(pkg as any),
        checkVersion(pkg as any),
        checkAvailableVersion(pkg as any)
    ]);
  }

  async function updateNodeJs(version: string = '22') {
    await runJob(`/system/update-node`, { version }, `Updating Node.js to v${version}...`);
    await checkVersion('node');
  }

  async function uninstallPackage(pkg: 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'mpd' | 'mympd') {
    const label = pkg === 'shairport-sync' ? 'Shairport Sync (AirPlay)' : pkg === 'mpd' ? 'MPD' : pkg === 'mympd' ? 'myMPD' : pkg;
    await runJob(`/system/uninstall/${pkg}`, null, `Uninstalling ${label}...`);
    await checkInstalled(pkg);
  }

  async function installSnapCtrl() {
    await runJob(`/system/install-snap-ctrl`, null, 'Installing snap-ctrl...');
    await checkInstalled('snap-ctrl');
    await checkStatus('snapserver');
    await checkVersion('snap-ctrl');
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

  async function fetchMympdInfo() {
    try {
      const data = await fetchApi('/system/mympd-info');
      if (typeof data.port === 'number') mympdPort.value = data.port;
      mympdRunning.value = !!data.running;
      installedPackages.value['mympd'] = !!data.installed;
    } catch (err) {
      console.error('Failed to fetch myMPD info:', err);
    }
  }

  const mympdUrl = computed(() => `http://${window.location.hostname}:${mympdPort.value}`);

  async function refreshAll() {
    loading.value = true;
    try {
      const data = await fetchApi('/system/dashboard');
      
      if (data.statuses.snapserver) snapserverStatus.value = data.statuses.snapserver;
      if (data.statuses.snapclient) snapclientStatus.value = data.statuses.snapclient;
      if (data.statuses['shairport-sync']) shairportSyncStatus.value = data.statuses['shairport-sync'];
      if (data.statuses['mpd']) mpdStatus.value = data.statuses['mpd'];
      if (data.statuses['mympd']) mympdStatus.value = data.statuses['mympd'];
      
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
    jobLog,
    error,
    snapserverStatus,
    snapclientStatus,
    shairportSyncStatus,
    mpdStatus,
    mympdStatus,
    mympdPort,
    mympdRunning,
    mympdUrl,
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
    fetchMympdInfo,
    refreshAll
  };
});
