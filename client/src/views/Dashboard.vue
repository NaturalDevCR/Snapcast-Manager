<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { useSnapcastStore } from '../stores/snapcast';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const systemStore = useSystemStore();
const uiStore = useUIStore();
const snapcastStore = useSnapcastStore();

const selectedNodeVersion = ref('20');
let pollingInterval: number | undefined;

onMounted(async () => {
  await systemStore.refreshAll();
  
  // Auto-select current installed Node.js version
  if (systemStore.packageVersions.node) {
    const match = systemStore.packageVersions.node.match(/v?(\d+)/);
    if (match && match[1]) {
      selectedNodeVersion.value = match[1];
    }
  }

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

const handleUninstall = async (pkg: 'shairport-sync') => {
  if (!confirm(`Are you sure you want to UNINSTALL ${pkg}? This will remove its binaries and service files.`)) return;
  try {
    await systemStore.uninstallPackage(pkg);
    uiStore.showToast(`${pkg} uninstalled successfully!`, 'success');
    await systemStore.refreshAll(); // Refresh status
  } catch (err: any) {
    uiStore.showToast(`Failed to uninstall ${pkg}: ` + err.message, 'error');
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

// Update this constant synchronously with the package.json version before release
const version = 'v0.1.48';
</script>

<template>
  <Layout>
    <div class="relative min-h-[60vh] space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <!-- Header Section -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-black tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">System Dashboard</h1>
          <p class="text-gray-400 font-medium mt-1">Manage and monitor your Snapcast infrastructure.</p>
        </div>
        <button @click="systemStore.refreshAll()" :disabled="systemStore.loading" class="inline-flex items-center px-5 py-2.5 bg-brand-primary hover:bg-[#8e0bc9] text-white rounded-xl text-sm font-black transition-all shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_20px_rgba(166,13,242,0.6)] active:scale-95 disabled:opacity-50 group border border-brand-primary/50">
          <span class="material-symbols-outlined text-[1.2rem] mr-2 transition-transform" :class="{'animate-spin': systemStore.loading, 'group-hover:rotate-180': !systemStore.loading}">refresh</span>
          SYNC ALL
        </button>
      </div>

      <!-- Loading Overlay (more subtle now) -->
      <div v-if="systemStore.loading" class="fixed inset-0 z-50 flex items-center justify-center bg-[#1c1022]/40 backdrop-blur-sm pointer-events-none">
          <div class="bg-[#2a1c31]/90 p-5 rounded-2xl shadow-2xl flex items-center space-x-3 border border-brand-primary/20 animate-in fade-in zoom-in duration-300 pointer-events-auto backdrop-blur-xl">
              <span class="material-symbols-outlined animate-spin text-brand-primary text-2xl">sync</span>
              <span class="text-sm font-bold text-white tracking-widest uppercase">{{ systemStore.loadingMessage || 'Syncing...' }}</span>
          </div>
      </div>

      <!-- Snapcast Live Metrics Section -->
      <div v-if="snapcastStore.status" class="space-y-4">
        <div class="flex items-center space-x-2 px-1">
            <span class="material-symbols-outlined text-[#00ff9d] animate-pulse">sensors</span>
            <h2 class="text-sm font-black text-white uppercase tracking-widest drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">Live Server Metrics</h2>
        </div>
        
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <!-- Streams Card -->
            <Card title="Active Streams">
                <template #icon>
                    <span class="material-symbols-outlined">queue_music</span>
                </template>
                <div class="flex flex-col h-full justify-between">
                    <div>
                        <div class="text-4xl font-black text-white mb-4 drop-shadow-[0_0_15px_rgba(166,13,242,0.4)]">
                            {{ snapcastStore.status.streams.length }}
                        </div>
                        <div class="space-y-2 max-h-[120px] overflow-y-auto pr-2 no-scrollbar">
                            <div v-for="stream in snapcastStore.status.streams" :key="stream.id" class="flex items-center justify-between p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-brand-primary/30 transition-colors">
                                <span class="text-xs font-bold text-gray-300 truncate max-w-[120px]" :title="stream.id">
                                    {{ stream.uri?.query?.name || stream.id }}
                                </span>
                                <span :class="stream.status === 'playing' ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20 drop-shadow-[0_0_8px_rgba(0,255,157,0.4)]' : 'text-gray-400 bg-white/5 border-white/10'" class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border">
                                    {{ stream.status }}
                                </span>
                            </div>
                            <div v-if="snapcastStore.status.streams.length === 0" class="text-xs text-gray-500 italic p-2">No active streams</div>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Clients Card -->
            <Card title="Connected Clients">
                <template #icon>
                    <span class="material-symbols-outlined">group</span>
                </template>
                <div class="flex flex-col h-full justify-between">
                    <div>
                        <div class="text-4xl font-black text-white mb-4 drop-shadow-[0_0_15px_rgba(166,13,242,0.4)]">
                            <!-- Safely calculate total connected clients across all groups -->
                            {{ snapcastStore.status.groups.reduce((acc, g) => acc + g.clients.filter(c => c.connected).length, 0) }}
                        </div>
                        <div class="space-y-2 max-h-[120px] overflow-y-auto pr-2 no-scrollbar">
                            <template v-for="group in snapcastStore.status.groups" :key="group.id">
                                <div v-for="client in group.clients.filter(c => c.connected)" :key="client.id" class="flex items-center justify-between p-2.5 rounded-xl bg-black/40 border border-white/5 hover:border-brand-primary/30 transition-colors">
                                    <div class="flex flex-col min-w-0">
                                        <span class="text-xs font-bold text-gray-300 truncate" :title="client.host.name">
                                            {{ client.config.name || client.host.name }}
                                        </span>
                                        <span class="text-[9px] text-gray-500 font-mono mt-0.5">{{ client.host.ip }}</span>
                                    </div>
                                    <span :class="client.config.volume.muted ? 'text-[#ff3b30] bg-[#ff3b30]/10 border-[#ff3b30]/20' : 'text-[#30d1ff] bg-[#30d1ff]/10 border-[#30d1ff]/20'" class="px-2 py-0.5 rounded-md text-[9px] border font-black uppercase tracking-widest flex-shrink-0">
                                        {{ client.config.volume.muted ? 'MUTED' : client.config.volume.percent + '%' }}
                                    </span>
                                </div>
                            </template>
                            <div v-if="snapcastStore.status.groups.reduce((acc, g) => acc + g.clients.filter(c => c.connected).length, 0) === 0" class="text-xs text-gray-500 italic p-2">No connected clients</div>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Server Health Card -->
            <Card title="Server Health">
                <template #icon>
                    <span class="material-symbols-outlined">health_and_safety</span>
                </template>
                <div class="flex flex-col h-full">
                    <div class="space-y-4">
                        <div class="flex items-center justify-between border-b border-white/5 pb-4">
                            <span class="text-sm font-semibold text-gray-400">Daemon Status</span>
                            <div class="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5 shadow-inner">
                                <span class="relative flex h-2 w-2">
                                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff9d] opacity-75"></span>
                                  <span class="relative inline-flex rounded-full h-2 w-2 bg-[#00ff9d]"></span>
                                </span>
                                <span class="text-[#00ff9d] font-black text-[10px] uppercase tracking-[0.2em] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">ONLINE</span>
                            </div>
                        </div>
                        <div class="flex items-center justify-between py-2">
                            <span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Snapserver Version</span>
                            <span class="text-sm font-mono font-bold text-brand-primary drop-shadow-[0_0_8px_rgba(166,13,242,0.3)]">{{ systemStore.packageVersions.snapserver || (snapcastStore.status ? snapcastStore.status.server.version : '...') }}</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-gray-500 uppercase tracking-widest">Active Groups</span>
                            <span class="text-sm font-black text-white bg-white/5 border border-white/10 px-3 py-1 rounded-lg">{{ snapcastStore.status.groups.length }}</span>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
      </div>
      
      <!-- System/Daemon Offline State -->
      <div v-else-if="!snapcastStore.loading && snapcastStore.error" class="bg-[#ff3b30]/10 border border-[#ff3b30]/30 rounded-2xl p-8 text-center backdrop-blur-xl shadow-[0_0_30px_rgba(255,59,48,0.1)]">
          <span class="material-symbols-outlined text-[3rem] text-[#ff3b30] drop-shadow-[0_0_15px_rgba(255,59,48,0.5)] mb-4">cloud_off</span>
          <h3 class="text-sm font-black text-white uppercase tracking-[0.2em] mb-2">Snapserver Offline or Unreachable</h3>
          <p class="text-xs text-gray-400 max-w-md mx-auto">{{ snapcastStore.error }}</p>
      </div>

      <div class="border-t border-white/5 my-10"></div>

      <!-- System Services Section -->
      <div class="flex items-center space-x-2 px-1 mb-4">
          <span class="material-symbols-outlined text-brand-primary">memory</span>
          <h2 class="text-sm font-black text-white uppercase tracking-widest drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">System Services</h2>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <!-- server Status -->
      <Card title="Snapserver">
        <template #icon>
            <span class="material-symbols-outlined">router</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">Installed</span>
                <span :class="systemStore.installedPackages.snapserver ? 'text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ff3b30] drop-shadow-[0_0_5px_rgba(255,59,48,0.5)]'" class="text-sm font-black">
                    {{ systemStore.installedPackages.snapserver ? 'YES' : 'NO' }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages.snapserver">
                 <span class="text-sm font-semibold text-gray-400">Status</span>
                 <span :class="systemStore.snapserverStatus === 'active' ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                     {{ systemStore.snapserverStatus }}
                 </span>
            </div>
            <div class="flex flex-col" v-if="systemStore.installedPackages.snapserver">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Version</span>
                    <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.snapserver || '...' }}</span>
                 </div>
                 <div v-if="systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown' && systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver" 
                       class="mt-2 bg-[#ffcc00]/10 border border-[#ffcc00]/20 text-[#ffcc00] text-[10px] px-3 py-2 rounded-xl font-black flex items-center justify-between">
                     <span>NEW VERSION: {{ systemStore.availableVersions.snapserver }}</span>
                     <span class="w-2 h-2 rounded-full bg-[#ffcc00] animate-pulse"></span>
                 </div>
                 <div v-else-if="systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown'" 
                       class="mt-2 bg-[#00ff9d]/5 border border-[#00ff9d]/20 text-[#00ff9d] text-[10px] px-3 py-1.5 rounded-xl font-black font-sans uppercase tracking-[0.2em] text-center drop-shadow-[0_0_5px_rgba(0,255,157,0.3)]">
                     UP TO DATE
                 </div>
            </div>

            <div class="pt-4 flex flex-col space-y-3 border-t border-white/5" v-if="systemStore.installedPackages.snapserver">
                <div class="grid grid-cols-2 gap-3">
                    <button @click="systemStore.controlService('restart', 'snapserver')" class="px-3 py-2.5 bg-black/40 hover:bg-white/10 text-white border border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Restart</button>
                    <button v-if="systemStore.snapserverStatus === 'active'" @click="systemStore.controlService('stop', 'snapserver')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Stop</button>
                    <button v-else @click="systemStore.controlService('start', 'snapserver')" class="px-3 py-2.5 bg-[#00ff9d]/10 hover:bg-[#00ff9d]/20 text-[#00ff9d] border border-[#00ff9d]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Start</button>
                </div>
                <button @click="handleUpdate('snapserver', systemStore.packageVersions.snapserver === systemStore.availableVersions.snapserver || systemStore.availableVersions.snapserver === 'unknown')" 
                        :class="[
                            'w-full px-4 py-3 rounded-xl text-xs font-black tracking-widest transition-all active:scale-95 disabled:opacity-50 uppercase',
                            systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown'
                            ? 'bg-brand-primary text-white border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)]' 
                            : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white border border-white/5'
                        ]"
                        :disabled="systemStore.loading">
                    {{ systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown' ? 'Install Update' : 'Clean Reinstall' }}
                </button>
            </div>
            <div class="pt-4 border-t border-white/5" v-else>
                 <button @click="systemStore.installPackage('snapserver')" class="w-full px-6 py-3 bg-brand-primary text-white rounded-xl font-black tracking-widest uppercase text-sm border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Install Snapserver</button>
            </div>
        </div>
      </Card>

      <!-- Snap-ctrl Status -->
      <Card title="Snap-ctrl">
        <template #icon>
            <span class="material-symbols-outlined">api</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">Status</span>
                <span :class="systemStore.installedPackages['snap-ctrl'] ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20 drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                    {{ systemStore.installedPackages['snap-ctrl'] ? 'INSTALLED' : 'NOT INSTALLED' }}
                </span>
            </div>
            <div class="flex flex-col">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Version</span>
                    <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions['snap-ctrl'] || '...' }}</span>
                 </div>
                 <div v-if="systemStore.availableVersions['snap-ctrl'] && systemStore.availableVersions['snap-ctrl'] !== 'unknown' && systemStore.packageVersions['snap-ctrl'] !== systemStore.availableVersions['snap-ctrl']" 
                       class="mt-2 bg-[#ffcc00]/10 border border-[#ffcc00]/20 text-[#ffcc00] text-[10px] px-3 py-2 rounded-xl font-black flex items-center justify-between">
                     <span>UPDATE READY</span>
                     <span class="w-2 h-2 rounded-full bg-[#ffcc00] animate-pulse"></span>
                 </div>
            </div>
            <p class="text-[11px] font-medium text-gray-500 leading-relaxed">The ultimate modern web controller for your Snapcast server infrastructure.</p>
            <div class="pt-3 border-t border-white/5">
                 <button @click="handleUpdate('snap-ctrl')" class="w-full px-4 py-3 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ systemStore.installedPackages['snap-ctrl'] ? 'Update Interface' : 'Install Interface' }}
                 </button>
            </div>
            <p v-if="systemStore.installedPackages['snap-ctrl']" class="text-[10px] font-black text-center text-gray-600 uppercase tracking-widest">
                Port 1780
            </p>
        </div>
      </Card>

      <!-- FFmpeg Status -->
      <Card title="FFmpeg">
        <template #icon>
            <span class="material-symbols-outlined">movie_creation</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">Toolkit</span>
                <span :class="systemStore.installedPackages.ffmpeg ? 'text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ff3b30] drop-shadow-[0_0_5px_rgba(255,59,48,0.5)]'" class="text-sm font-black">
                    {{ systemStore.installedPackages.ffmpeg ? 'READY' : 'ABSENT' }}
                </span>
            </div>
            <div class="flex flex-col" v-if="systemStore.installedPackages.ffmpeg">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Version Info</span>
                    <span class="text-xs font-mono font-bold text-gray-300 truncate max-w-[150px]">{{ systemStore.packageVersions.ffmpeg || '...' }}</span>
                 </div>
            </div>
            <div class="pt-3 border-t border-white/5" v-if="!systemStore.installedPackages.ffmpeg">
                 <button @click="systemStore.installPackage('ffmpeg')" class="w-full px-4 py-3 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    Install FFmpeg
                 </button>
            </div>
            <div class="pt-4 flex flex-col space-y-4 border-t border-white/5" v-else>
                <div class="p-3 bg-brand-primary/5 border border-brand-primary/20 rounded-xl shadow-[inset_0_0_15px_rgba(166,13,242,0.1)]">
                    <p class="text-[10px] font-bold text-brand-primary uppercase tracking-widest leading-relaxed text-center">FFmpeg is optimized and ready for high-fidelity audio transcoding.</p>
                </div>
                <button @click="handleUpdate('ffmpeg')" class="w-full px-4 py-3 bg-black/40 text-gray-300 rounded-xl hover:bg-white/10 hover:text-white border border-white/5 transition-all text-xs font-black uppercase tracking-widest active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Refresh Packages</button>
            </div>
        </div>
      </Card>

      <!-- Shairport-sync (AirPlay) Status -->
      <Card title="AirPlay Service">
        <template #icon>
            <span class="material-symbols-outlined">cast</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">Receiver</span>
                <span :class="systemStore.installedPackages['shairport-sync'] ? 'text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ff3b30] drop-shadow-[0_0_5px_rgba(255,59,48,0.5)]'" class="text-sm font-black">
                    {{ systemStore.installedPackages['shairport-sync'] ? 'ENABLED' : 'DISABLED' }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages['shairport-sync']">
                 <span class="text-sm font-semibold text-gray-400">Status</span>
                 <span :class="systemStore.shairportSyncStatus === 'active' ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                     {{ systemStore.shairportSyncStatus }}
                 </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.packageVersions['shairport-sync']">
                  <span class="text-sm font-semibold text-gray-400">Version</span>
                  <span class="text-sm font-bold text-gray-200">
                      {{ systemStore.packageVersions['shairport-sync'] }}
                  </span>
             </div>
            <div class="pt-4 flex flex-col space-y-3 border-t border-white/5" v-if="systemStore.installedPackages['shairport-sync']">
                <div class="grid grid-cols-2 gap-3">
                    <button @click="systemStore.controlService('restart', 'shairport-sync')" class="px-3 py-2.5 bg-black/40 hover:bg-white/10 text-white border border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Restart</button>
                    <button v-if="systemStore.shairportSyncStatus === 'active'" @click="systemStore.controlService('stop', 'shairport-sync')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Stop</button>
                    <button v-else @click="systemStore.controlService('start', 'shairport-sync')" class="px-3 py-2.5 bg-[#00ff9d]/10 hover:bg-[#00ff9d]/20 text-[#00ff9d] border border-[#00ff9d]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Start</button>
                </div>
                <button @click="handleUpdate('shairport-sync')" class="w-full px-4 py-3 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    Update Shairport
                </button>
                <button @click="handleUninstall('shairport-sync')" class="w-full px-4 py-3 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    Uninstall AirPlay
                </button>
            </div>
            <div class="pt-4 border-t border-white/5" v-else>
                 <button @click="systemStore.installPackage('shairport-sync')" class="w-full px-6 py-3 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-sm border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    Install AirPlay
                 </button>
            </div>
        </div>
      </Card>

      <!-- Node.js Status -->
      <Card title="Runtime Environment">
        <template #icon>
            <span class="material-symbols-outlined">javascript</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">Node.js</span>
                <span class="text-[#00ff9d] font-black text-sm tracking-widest leading-none drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">
                    {{ systemStore.packageVersions.node || 'UNKNOWN' }}
                </span>
            </div>
            <div class="flex flex-col">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Engine Version</span>
                    <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.node || '...' }}</span>
                 </div>
                 
                 <div class="mt-4 space-y-3">
                    <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest block border-b border-white/5 pb-2">Select LTS Release</span>
                    <div class="grid grid-cols-3 gap-3">
                        <button v-for="v in ['18', '20', '22']" :key="v"
                                @click="selectedNodeVersion = v"
                                :class="[
                                    'py-2.5 rounded-xl text-xs font-black transition-all border',
                                    selectedNodeVersion === v 
                                    ? 'bg-[#00ff9d]/10 border-[#00ff9d]/30 text-[#00ff9d] drop-shadow-[0_0_8px_rgba(0,255,157,0.4)]' 
                                    : 'bg-black/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-300'
                                ]"
                        >
                            v{{ v }}
                        </button>
                    </div>
                 </div>
            </div>
            <div class="pt-5 border-t border-white/5">
                 <button @click="handleUpdateNodeJs" class="w-full px-4 py-3 bg-brand-primary text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    Update to v{{ selectedNodeVersion }}
                 </button>
            </div>
        </div>
      </Card>

      <!-- Snapmanager Core -->
      <Card title="Management Core">
        <template #icon>
            <span class="material-symbols-outlined">dashboard_customize</span>
        </template>
        <div class="space-y-4 h-full flex flex-col">
            <div class="flex flex-col space-y-2 flex-grow">
                <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Application Version</span>
                <span class="text-4xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">{{ version }}</span>
            </div>
            <div class="p-3 bg-brand-primary/5 border border-brand-primary/20 rounded-xl shadow-[inset_0_0_15px_rgba(166,13,242,0.1)] mt-auto mb-4">
                <p class="text-[10px] font-bold text-brand-primary leading-relaxed text-center tracking-widest uppercase">Everything is synced and running smoothly on version {{ version }}.</p>
            </div>
            <div class="pt-4 border-t border-white/5">
                 <button disabled class="w-full px-4 py-3 bg-black/40 text-gray-500 rounded-xl font-black text-xs uppercase tracking-widest cursor-default border border-white/5">
                    UI Up to Date
                 </button>
            </div>
        </div>
      </Card>
    </div>

    <!-- Footer -->
    <div class="mt-16 pt-8 border-t border-white/5 text-center pb-8 opacity-60 hover:opacity-100 transition-opacity">
        <p class="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em] flex items-center justify-center space-x-2">
            <span class="material-symbols-outlined text-[14px]">terminal</span>
            <span>2026 Snapcast Manager Ecosystem &bull; VERSION {{ version }}</span>
        </p>
        <a href="https://github.com/jdavidoa91/Snapcast-Manager" target="_blank" rel="noopener noreferrer" class="inline-flex items-center space-x-1 mt-4 text-xs font-black text-brand-primary hover:text-[#8e0bc9] transition-colors group">
           <span>Developed by NaturalDevCR</span>
           <span class="material-symbols-outlined text-[14px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
        </a>
    </div>
  </div>
</Layout>
</template>
