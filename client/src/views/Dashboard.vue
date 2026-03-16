<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { useSnapcastStore } from '../stores/snapcast';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import { 
    ServerIcon, GlobeAltIcon, VideoCameraIcon, 
    SpeakerWaveIcon, CommandLineIcon, SignalIcon, 
    UserGroupIcon, MusicalNoteIcon 
} from '@heroicons/vue/24/outline';

const systemStore = useSystemStore();
const uiStore = useUIStore();
const snapcastStore = useSnapcastStore();

const selectedNodeVersion = ref('20');
let pollingInterval: number | undefined;

onMounted(() => {
  systemStore.refreshAll();
  snapcastStore.fetchStatus();
  // Poll Snapcast status every 3 seconds for live dashboard updates
  pollingInterval = window.setInterval(() => {
    snapcastStore.fetchStatus();
  }, 3000);
});

onUnmounted(() => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
});

const handleUpdate = async (pkg: 'snapserver' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl', clean: boolean = false) => {
  if (clean && !confirm(`WARNING: This will UNINSTALL ${pkg} and DELETE ALL its configuration and data files before a fresh installation. Continue?`)) {
      return;
  }
  
  try {
    await systemStore.updatePackage(pkg, clean);
    uiStore.showToast(`${pkg} ${clean ? 'reinstalled' : 'updated'} successfully!`, 'success');
  } catch (err: any) {
    uiStore.showToast(`Failed to ${clean ? 'reinstall' : 'update'} ${pkg}: ` + err.message, 'error');
  }
};

const handleUpdateNodeJs = async () => {
    if (!confirm(`This will update Node.js to the latest ${selectedNodeVersion.value}.x version. The service might restart briefly. Continue?`)) return;
    try {
        await systemStore.updateNodeJs(selectedNodeVersion.value);
        uiStore.showToast(`Node.js ${selectedNodeVersion.value} update initiated successfully!`, 'success');
    } catch (err: any) {
        uiStore.showToast('Failed to update Node.js: ' + err.message, 'error');
    }
};

// Version from package.json
const version = 'v0.1.27';
</script>

<template>
  <Layout>
    <div class="relative min-h-[60vh] space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <!-- Header Section -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-black text-slate-900 dark:text-white tracking-tight">System Dashboard</h1>
          <p class="text-slate-500 dark:text-slate-400 font-medium">Manage and monitor your Snapcast infrastructure.</p>
        </div>
        <button @click="systemStore.refreshAll()" :disabled="systemStore.loading" class="inline-flex items-center px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm active:scale-95 disabled:opacity-50">
          <svg class="w-4 h-4 mr-2" :class="{'animate-spin': systemStore.loading}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh All
        </button>
      </div>

      <!-- Loading Overlay (more subtle now) -->
      <div v-if="systemStore.loading" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/10 backdrop-blur-[2px] pointer-events-none">
          <div class="bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-2xl flex items-center space-x-3 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in duration-300 pointer-events-auto">
              <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
              <span class="text-sm font-bold text-slate-700 dark:text-slate-200">Syncing...</span>
          </div>
      </div>

      <!-- Snapcast Live Metrics Section -->
      <div v-if="snapcastStore.status" class="space-y-4">
        <div class="flex items-center space-x-2 px-1">
            <SignalIcon class="h-5 w-5 text-emerald-500 animate-pulse" />
            <h2 class="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest">Live Server Metrics</h2>
        </div>
        
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <!-- Streams Card -->
            <Card title="Active Streams">
                <template #icon>
                    <div class="p-2 bg-emerald-500/10 rounded-lg">
                        <MusicalNoteIcon class="h-5 w-5 text-emerald-500" />
                    </div>
                </template>
                <div class="flex flex-col h-full justify-between">
                    <div>
                        <div class="text-3xl font-black text-slate-900 dark:text-white mb-4">
                            {{ snapcastStore.status.streams.length }}
                        </div>
                        <div class="space-y-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                            <div v-for="stream in snapcastStore.status.streams" :key="stream.id" class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                                <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate max-w-[120px]" :title="stream.id">
                                    {{ stream.uri?.query?.name || stream.id }}
                                </span>
                                <span :class="stream.status === 'playing' ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-500 bg-slate-500/10'" class="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">
                                    {{ stream.status }}
                                </span>
                            </div>
                            <div v-if="snapcastStore.status.streams.length === 0" class="text-xs text-slate-400 italic">No active streams</div>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Clients Card -->
            <Card title="Connected Clients">
                <template #icon>
                    <div class="p-2 bg-blue-500/10 rounded-lg">
                        <UserGroupIcon class="h-5 w-5 text-blue-500" />
                    </div>
                </template>
                <div class="flex flex-col h-full justify-between">
                    <div>
                        <div class="text-3xl font-black text-slate-900 dark:text-white mb-4">
                            <!-- Safely calculate total connected clients across all groups -->
                            {{ snapcastStore.status.groups.reduce((acc, g) => acc + g.clients.filter(c => c.connected).length, 0) }}
                        </div>
                        <div class="space-y-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                            <template v-for="group in snapcastStore.status.groups" :key="group.id">
                                <div v-for="client in group.clients.filter(c => c.connected)" :key="client.id" class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                                    <div class="flex flex-col min-w-0">
                                        <span class="text-xs font-bold text-slate-700 dark:text-slate-300 truncate" :title="client.host.name">
                                            {{ client.config.name || client.host.name }}
                                        </span>
                                        <span class="text-[9px] text-slate-400 font-mono">{{ client.host.ip }}</span>
                                    </div>
                                    <span :class="client.config.volume.muted ? 'text-red-500 bg-red-500/10' : 'text-blue-500 bg-blue-500/10'" class="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider flex-shrink-0">
                                        {{ client.config.volume.muted ? 'MUTED' : client.config.volume.percent + '%' }}
                                    </span>
                                </div>
                            </template>
                            <div v-if="snapcastStore.status.groups.reduce((acc, g) => acc + g.clients.filter(c => c.connected).length, 0) === 0" class="text-xs text-slate-400 italic">No connected clients</div>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Server Health Card -->
            <Card title="Server Health">
                <template #icon>
                    <div class="p-2 bg-indigo-500/10 rounded-lg">
                        <ServerIcon class="h-5 w-5 text-indigo-500" />
                    </div>
                </template>
                <div class="flex flex-col h-full">
                    <div class="space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 pb-3">
                            <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Daemon Status</span>
                            <div class="flex items-center space-x-2">
                                <span class="relative flex h-2 w-2">
                                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                <span class="text-emerald-500 font-black text-xs uppercase tracking-widest">ONLINE</span>
                            </div>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Snapserver Version</span>
                            <span class="text-sm font-mono text-slate-700 dark:text-slate-300">{{ snapcastStore.status.server.version }}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Groups</span>
                            <span class="text-sm font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-md">{{ snapcastStore.status.groups.length }}</span>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
      </div>
      
      <!-- System/Daemon Offline State -->
      <div v-else-if="!snapcastStore.loading && snapcastStore.error" class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl p-6 text-center">
          <ServerIcon class="h-8 w-8 text-red-400 mx-auto mb-3" />
          <h3 class="text-sm font-black text-red-700 dark:text-red-400 uppercase tracking-widest">Snapserver Offline or Unreachable</h3>
          <p class="text-xs text-red-600 dark:text-red-300 mt-2 max-w-md mx-auto">{{ snapcastStore.error }}</p>
      </div>

      <div class="border-t border-slate-200 dark:border-slate-700/50 my-8"></div>

      <!-- System Services Section -->
      <div class="flex items-center space-x-2 px-1 mb-2">
          <CommandLineIcon class="h-5 w-5 text-slate-400" />
          <h2 class="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest">System Services</h2>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <!-- server Status -->
      <Card title="Snapserver">
        <template #icon>
            <div class="p-2 bg-indigo-500/10 rounded-lg">
                <ServerIcon class="h-5 w-5 text-indigo-500" />
            </div>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Installed</span>
                <span :class="systemStore.installedPackages.snapserver ? 'text-green-500' : 'text-red-500'" class="text-sm font-black">
                    {{ systemStore.installedPackages.snapserver ? 'YES' : 'NO' }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages.snapserver">
                 <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Status</span>
                 <span :class="systemStore.snapserverStatus === 'active' ? 'text-green-500 bg-green-500/10' : 'text-yellow-500 bg-yellow-500/10'" class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                     {{ systemStore.snapserverStatus }}
                 </span>
            </div>
            <div class="flex flex-col" v-if="systemStore.installedPackages.snapserver">
                 <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-bold text-slate-400 uppercase">Version</span>
                    <span class="text-sm font-mono text-slate-700 dark:text-slate-300">{{ systemStore.packageVersions.snapserver || '...' }}</span>
                 </div>
                 <div v-if="systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown' && systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver" 
                       class="mt-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] px-3 py-1.5 rounded-lg font-black flex items-center justify-between">
                     <span>NEW VERSION: {{ systemStore.availableVersions.snapserver }}</span>
                     <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                 </div>
                 <div v-else-if="systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown'" 
                       class="mt-1 bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-[10px] px-3 py-1 rounded-lg font-black font-sans uppercase tracking-[0.05em] text-center">
                     UP TO DATE
                 </div>
            </div>

            <div class="pt-4 flex flex-col space-y-2" v-if="systemStore.installedPackages.snapserver">
                <div class="grid grid-cols-2 gap-2">
                    <button @click="systemStore.controlService('restart', 'snapserver')" class="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Restart</button>
                    <button v-if="systemStore.snapserverStatus === 'active'" @click="systemStore.controlService('stop', 'snapserver')" class="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-red-500 hover:text-white transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Stop</button>
                    <button v-else @click="systemStore.controlService('start', 'snapserver')" class="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-green-500 hover:text-white transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Start</button>
                </div>
                <button @click="handleUpdate('snapserver', systemStore.packageVersions.snapserver === systemStore.availableVersions.snapserver || systemStore.availableVersions.snapserver === 'unknown')" 
                        :class="[
                            'w-full px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-50',
                            systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown'
                            ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/20' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                        ]"
                        :disabled="systemStore.loading">
                    {{ systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown' ? 'INSTALL UPDATE' : 'CLEAN REINSTALL / FIX' }}
                </button>
            </div>
            <div class="pt-4" v-else>
                 <button @click="systemStore.installPackage('snapserver')" class="w-full px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">INSTALL SNAPSERVER</button>
            </div>
        </div>
      </Card>

      <!-- Snap-ctrl Status -->
      <Card title="Snap-ctrl">
        <template #icon>
            <div class="p-2 bg-pink-500/10 rounded-lg">
                <GlobeAltIcon class="h-5 w-5 text-pink-500" />
            </div>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Status</span>
                <span :class="systemStore.installedPackages['snap-ctrl'] ? 'text-green-500 bg-green-500/10' : 'text-yellow-500 bg-yellow-500/10'" class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                    {{ systemStore.installedPackages['snap-ctrl'] ? 'INSTALLED' : 'NOT INSTALLED' }}
                </span>
            </div>
            <div class="flex flex-col">
                 <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-bold text-slate-400 uppercase">Version</span>
                    <span class="text-sm font-mono text-slate-700 dark:text-slate-300">{{ systemStore.packageVersions['snap-ctrl'] || '...' }}</span>
                 </div>
                 <div v-if="systemStore.availableVersions['snap-ctrl'] && systemStore.availableVersions['snap-ctrl'] !== 'unknown' && systemStore.packageVersions['snap-ctrl'] !== systemStore.availableVersions['snap-ctrl']" 
                       class="mt-1 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] px-3 py-1.5 rounded-lg font-black flex items-center justify-between">
                     <span>UPDATE READY</span>
                     <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                 </div>
            </div>
            <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed">The ultimate modern web controller for your Snapcast server infrastructure.</p>
            <div class="pt-2">
                 <button @click="handleUpdate('snap-ctrl')" class="w-full px-4 py-2.5 bg-pink-600 text-white rounded-xl font-black text-xs hover:bg-pink-700 shadow-lg shadow-pink-500/20 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ systemStore.installedPackages['snap-ctrl'] ? 'UPDATE INTERFACE' : 'INSTALL INTERFACE' }}
                 </button>
            </div>
            <p v-if="systemStore.installedPackages['snap-ctrl']" class="text-[10px] font-bold text-center text-slate-400 uppercase tracking-widest">
                Port 1780
            </p>
        </div>
      </Card>

      <!-- FFmpeg Status -->
      <Card title="FFmpeg">
        <template #icon>
            <div class="p-2 bg-purple-500/10 rounded-lg">
                <VideoCameraIcon class="h-5 w-5 text-purple-500" />
            </div>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Toolkit</span>
                <span :class="systemStore.installedPackages.ffmpeg ? 'text-green-500' : 'text-red-500'" class="text-sm font-black">
                    {{ systemStore.installedPackages.ffmpeg ? 'READY' : 'ABSENT' }}
                </span>
            </div>
            <div class="flex flex-col" v-if="systemStore.installedPackages.ffmpeg">
                 <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-bold text-slate-400 uppercase">Version Info</span>
                    <span class="text-[10px] font-mono text-slate-700 dark:text-slate-300 truncate max-w-[150px]">{{ systemStore.packageVersions.ffmpeg || '...' }}</span>
                 </div>
            </div>
            <div class="pt-2" v-if="!systemStore.installedPackages.ffmpeg">
                 <button @click="systemStore.installPackage('ffmpeg')" class="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-xs hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">INSTALL FFMPEG</button>
            </div>
            <div class="pt-2 flex flex-col space-y-3" v-else>
                <div class="p-2.5 bg-purple-500/5 border border-purple-500/10 rounded-xl">
                    <p class="text-[10px] font-bold text-purple-600 dark:text-purple-400 leading-tight">FFmpeg is optimized and ready for high-fidelity audio transcoding.</p>
                </div>
                <button @click="handleUpdate('ffmpeg')" class="w-full px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-purple-500 hover:text-white transition-all text-xs font-black active:scale-95" :disabled="systemStore.loading">REFRESH PACKAGES</button>
            </div>
        </div>
      </Card>

      <!-- Shairport-sync (AirPlay) Status -->
      <Card title="AirPlay Service">
        <template #icon>
            <div class="p-2 bg-orange-500/10 rounded-lg">
                <SpeakerWaveIcon class="h-5 w-5 text-orange-500" />
            </div>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Receiver</span>
                <span :class="systemStore.installedPackages['shairport-sync'] ? 'text-green-500' : 'text-red-500'" class="text-sm font-black">
                    {{ systemStore.installedPackages['shairport-sync'] ? 'ENABLED' : 'DISABLED' }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages['shairport-sync']">
                 <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Status</span>
                 <span :class="systemStore.shairportSyncStatus === 'active' ? 'text-green-500 bg-green-500/10' : 'text-yellow-500 bg-yellow-500/10'" class="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                     {{ systemStore.shairportSyncStatus }}
                 </span>
            </div>
            <div class="pt-2 flex flex-col space-y-2" v-if="systemStore.installedPackages['shairport-sync']">
                <div class="grid grid-cols-2 gap-2">
                    <button @click="systemStore.controlService('restart', 'shairport-sync')" class="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Restart</button>
                    <button v-if="systemStore.shairportSyncStatus === 'active'" @click="systemStore.controlService('stop', 'shairport-sync')" class="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-red-500 hover:text-white transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Stop</button>
                    <button v-else @click="systemStore.controlService('start', 'shairport-sync')" class="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-green-500 hover:text-white transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Start</button>
                </div>
                <button @click="handleUpdate('shairport-sync')" class="w-full px-4 py-2.5 bg-orange-600 text-white rounded-xl font-black text-xs hover:bg-orange-700 shadow-lg shadow-orange-500/20 transition-all active:scale-95" :disabled="systemStore.loading">UPDATE SHAIRPORT</button>
            </div>
            <div class="pt-2" v-else>
                 <button @click="systemStore.installPackage('shairport-sync')" class="w-full px-6 py-3 bg-orange-600 text-white rounded-xl font-black text-sm hover:bg-orange-700 shadow-lg shadow-orange-500/20 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">INSTALL AIRPLAY</button>
            </div>
        </div>
      </Card>

      <!-- Node.js Status -->
      <Card title="Runtime Environment">
        <template #icon>
            <div class="p-2 bg-green-500/10 rounded-lg">
                <GlobeAltIcon class="h-5 w-5 text-green-600" />
            </div>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">Node.js</span>
                <span class="text-green-500 font-black text-sm tracking-widest leading-none">STABLE</span>
            </div>
            <div class="flex flex-col">
                 <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Engine Version</span>
                    <span class="text-sm font-mono text-slate-700 dark:text-slate-300">{{ systemStore.packageVersions.node || '...' }}</span>
                 </div>
                 
                 <div class="mt-3 space-y-2">
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select LTS Release</span>
                    <div class="grid grid-cols-3 gap-2">
                        <button v-for="v in ['18', '20', '22']" :key="v"
                                @click="selectedNodeVersion = v"
                                :class="[
                                    'py-1.5 rounded-lg text-[10px] font-bold transition-all border',
                                    selectedNodeVersion === v 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
                                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                                ]"
                        >
                            v{{ v }}
                        </button>
                    </div>
                 </div>
            </div>
            <div class="pt-4">
                 <button @click="handleUpdateNodeJs" class="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    UPDATE TO v{{ selectedNodeVersion }}
                 </button>
            </div>
        </div>
      </Card>

      <!-- Snapmanager Core -->
      <Card title="Management Core">
        <template #icon>
            <div class="p-2 bg-slate-500/10 rounded-lg">
                <CommandLineIcon class="h-5 w-5 text-slate-500" />
            </div>
        </template>
        <div class="space-y-4">
            <div class="flex flex-col space-y-1">
                <span class="text-xs font-bold text-slate-400 uppercase tracking-widest">Application Version</span>
                <span class="text-2xl font-black text-slate-900 dark:text-white">{{ version }}</span>
            </div>
            <div class="p-2.5 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                <p class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 leading-tight">Everything is synced and running smoothly on version {{ version }}.</p>
            </div>
            <div class="pt-2">
                 <button disabled class="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-xl font-black text-xs cursor-default">
                    UI UP TO DATE
                 </button>
            </div>
        </div>
      </Card>
    </div>

    <!-- Footer -->
    <div class="mt-16 pt-8 border-t border-slate-200 dark:border-slate-800 text-center pb-8">
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">
            &copy; 2026 Snapcast Manager Ecosystem &bull; VERSION {{ version }}
        </p>
    </div>
  </div>
</Layout>
</template>
