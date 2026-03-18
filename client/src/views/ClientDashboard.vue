<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const systemStore = useSystemStore();
const uiStore = useUIStore();

const snapclientConfig = ref('');
const configLoading = ref(false);

onMounted(async () => {
  await systemStore.refreshAll();
  await loadSnapclientConfig();
});

async function loadSnapclientConfig() {
  try {
    const data = await fetchApi('/config/snapclient');
    snapclientConfig.value = data.content;
  } catch (err) {
    console.error('Failed to load snapclient config:', err);
  }
}

async function saveSnapclientConfig() {
  configLoading.value = true;
  try {
    await fetchApi('/config/snapclient', {
      method: 'POST',
      body: JSON.stringify({ content: snapclientConfig.value }),
    });
    uiStore.showToast('Snapclient config saved successfully!', 'success');
  } catch (err: any) {
    uiStore.showToast('Failed to save config: ' + err.message, 'error');
  } finally {
    configLoading.value = false;
  }
}

const handleUpdate = async (clean: boolean = false) => {
  if (clean && !confirm('WARNING: This will UNINSTALL snapclient and DELETE its config before a fresh installation. Continue?')) return;
  try {
    await systemStore.updatePackage('snapclient', clean);
    uiStore.showToast(`snapclient ${clean ? 'reinstalled' : 'updated'} successfully!`, 'success');
  } catch (err: any) {
    uiStore.showToast(`Failed to ${clean ? 'reinstall' : 'update'} snapclient: ` + err.message, 'error');
  }
};

const handleUninstall = async () => {
  if (!confirm('Are you sure you want to UNINSTALL snapclient?')) return;
  try {
    await systemStore.uninstallPackage('snapclient');
    uiStore.showToast('snapclient uninstalled successfully!', 'success');
    await systemStore.refreshAll();
  } catch (err: any) {
    uiStore.showToast('Failed to uninstall snapclient: ' + err.message, 'error');
  }
};
</script>

<template>
  <Layout>
    <div class="relative min-h-[60vh] space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-black tracking-tight text-text-main">Client Dashboard</h1>
          <p class="text-text-muted font-medium mt-1">Manage and monitor your Snapclient audio receiver.</p>
        </div>
        <button @click="systemStore.refreshAll()" :disabled="systemStore.loading" class="inline-flex items-center px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-brand-primary/30 active:scale-95 disabled:opacity-50 group border border-brand-primary/50">
          <span class="material-symbols-outlined text-[1.2rem] mr-2 transition-transform" :class="{'animate-spin': systemStore.loading, 'group-hover:rotate-180': !systemStore.loading}">refresh</span>
          SYNC ALL
        </button>
      </div>

      <!-- Loading Overlay -->
      <div v-if="systemStore.loading" class="fixed inset-0 z-50 flex items-center justify-center bg-[#1c1022]/40 backdrop-blur-sm pointer-events-none">
        <div class="bg-[#2a1c31]/90 p-5 rounded-2xl shadow-2xl flex items-center space-x-3 border border-brand-primary/20 animate-in fade-in zoom-in duration-300 pointer-events-auto backdrop-blur-xl">
          <span class="material-symbols-outlined animate-spin text-brand-primary text-2xl">sync</span>
          <span class="text-sm font-bold text-white tracking-widest uppercase">{{ systemStore.loadingMessage || 'Syncing...' }}</span>
        </div>
      </div>

      <!-- Section Label -->
      <div class="flex items-center space-x-2 px-1">
        <span class="material-symbols-outlined text-brand-primary">speaker</span>
        <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">Snapclient Service</h2>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <!-- Snapclient Package Card -->
        <Card title="Snapclient">
          <template #icon>
            <span class="material-symbols-outlined">speaker</span>
          </template>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-gray-400">Installed</span>
              <span :class="systemStore.installedPackages.snapclient ? 'text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ff3b30] drop-shadow-[0_0_5px_rgba(255,59,48,0.5)]'" class="text-sm font-black">
                {{ systemStore.installedPackages.snapclient ? 'YES' : 'NO' }}
              </span>
            </div>

            <div class="flex items-center justify-between" v-if="systemStore.installedPackages.snapclient">
              <span class="text-sm font-semibold text-gray-400">Status</span>
              <span :class="systemStore.snapclientStatus === 'active' ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                {{ systemStore.snapclientStatus }}
              </span>
            </div>

            <div class="flex flex-col" v-if="systemStore.installedPackages.snapclient">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Version</span>
                <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.snapclient || '...' }}</span>
              </div>
              <div v-if="systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown' && systemStore.packageVersions.snapclient !== systemStore.availableVersions.snapclient"
                   class="mt-2 bg-[#ffcc00]/10 border border-[#ffcc00]/20 text-[#ffcc00] text-[10px] px-3 py-2 rounded-xl font-black flex items-center justify-between">
                <span>NEW VERSION: {{ systemStore.availableVersions.snapclient }}</span>
                <span class="w-2 h-2 rounded-full bg-[#ffcc00] animate-pulse"></span>
              </div>
              <div v-else-if="systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown'"
                   class="mt-2 bg-[#00ff9d]/5 border border-[#00ff9d]/20 text-[#00ff9d] text-[10px] px-3 py-1.5 rounded-xl font-black font-sans uppercase tracking-[0.2em] text-center drop-shadow-[0_0_5px_rgba(0,255,157,0.3)]">
                UP TO DATE
              </div>
            </div>

            <!-- Service Controls -->
            <div class="pt-4 flex flex-col space-y-3 border-t border-white/5" v-if="systemStore.installedPackages.snapclient">
              <div class="grid grid-cols-2 gap-3">
                <button @click="systemStore.controlService('restart', 'snapclient')" class="px-3 py-2.5 bg-black/40 hover:bg-white/10 text-white border border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Restart</button>
                <button v-if="systemStore.snapclientStatus === 'active'" @click="systemStore.controlService('stop', 'snapclient')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Stop</button>
                <button v-else @click="systemStore.controlService('start', 'snapclient')" class="px-3 py-2.5 bg-[#00ff9d]/10 hover:bg-[#00ff9d]/20 text-[#00ff9d] border border-[#00ff9d]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">Start</button>
              </div>
              <button
                @click="handleUpdate(systemStore.packageVersions.snapclient === systemStore.availableVersions.snapclient || systemStore.availableVersions.snapclient === 'unknown')"
                :class="[
                  'w-full px-4 py-3 rounded-xl text-xs font-black tracking-widest transition-all active:scale-95 disabled:opacity-50 uppercase',
                  systemStore.packageVersions.snapclient !== systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown'
                  ? 'bg-brand-primary text-white border border-brand-primary/50 shadow-xl shadow-brand-primary/30 hover:shadow-brand-primary/50 hover:bg-brand-primary/80'
                  : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white border border-white/5'
                ]"
                :disabled="systemStore.loading">
                {{ systemStore.packageVersions.snapclient !== systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown' ? 'Install Update' : 'Clean Reinstall' }}
              </button>
              <button @click="handleUninstall" class="w-full px-4 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                Uninstall
              </button>
            </div>

            <!-- Install Button -->
            <div class="pt-4 border-t border-white/5" v-else>
              <button @click="systemStore.installPackage('snapclient')" class="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black tracking-widest uppercase text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                Install Snapclient
              </button>
            </div>
          </div>
        </Card>

        <!-- Connection Info -->
        <Card title="Connection">
          <template #icon>
            <span class="material-symbols-outlined">network_node</span>
          </template>
          <div class="space-y-3">
            <div class="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <p class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">About Snapclient</p>
              <p class="text-xs text-gray-400 leading-relaxed">Snapclient is an audio receiver that connects to a Snapserver. Configure the server host in <span class="font-mono text-brand-primary">/etc/default/snapclient</span> via the config editor below.</p>
            </div>
            <div class="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between">
              <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Service</span>
              <span :class="systemStore.snapclientStatus === 'active' ? 'text-[#00ff9d]' : 'text-[#ff3b30]'" class="text-xs font-black uppercase">
                {{ systemStore.snapclientStatus }}
              </span>
            </div>
            <div class="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between">
              <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Version</span>
              <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.snapclient || 'N/A' }}</span>
            </div>
          </div>
        </Card>

        <!-- Runtime Environment (reused from server dashboard) -->
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
            <p class="text-xs text-gray-500">Used by Snapcast Manager itself. Upgrade from the Server dashboard if needed.</p>
          </div>
        </Card>
      </div>

      <!-- Snapclient Config Editor -->
      <div v-if="systemStore.installedPackages.snapclient" class="border-t border-white/5 pt-8">
        <div class="flex items-center space-x-2 px-1 mb-6">
          <span class="material-symbols-outlined text-brand-primary">edit_note</span>
          <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">Snapclient Configuration</h2>
          <span class="text-[10px] text-gray-500 font-mono ml-2">/etc/default/snapclient</span>
        </div>
        <Card title="Config Editor">
          <template #icon>
            <span class="material-symbols-outlined">tune</span>
          </template>
          <div class="space-y-4">
            <p class="text-xs text-gray-400">Edit the environment file used by the snapclient systemd service. Set <span class="font-mono text-brand-primary">SNAPCLIENT_OPTS</span> to configure the server host (<code class="text-brand-primary">-h</code>), port (<code class="text-brand-primary">-p</code>), sound card (<code class="text-brand-primary">-s</code>), etc.</p>
            <p class="text-[10px] text-gray-500 font-mono">Example: <span class="text-brand-primary">SNAPCLIENT_OPTS="-h 192.168.1.10 -p 1704"</span></p>
            <textarea
              v-model="snapclientConfig"
              rows="8"
              class="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-xs font-mono text-gray-300 focus:outline-none focus:border-brand-primary/50 resize-y"
              placeholder="# snapclient default options&#10;SNAPCLIENT_OPTS=&quot;&quot;"
            ></textarea>
            <div class="flex gap-3">
              <button
                @click="saveSnapclientConfig"
                :disabled="configLoading || systemStore.loading"
                class="flex-1 px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {{ configLoading ? 'Saving...' : 'Save & Apply' }}
              </button>
              <button
                @click="systemStore.controlService('restart', 'snapclient')"
                :disabled="systemStore.loading"
                class="px-4 py-3 bg-black/40 hover:bg-white/10 text-white border border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50"
              >
                Restart Service
              </button>
            </div>
          </div>
        </Card>
      </div>

    </div>
  </Layout>
</template>
