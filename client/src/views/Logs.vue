<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { useSnapclientInstancesStore } from '../stores/snapclientInstances';

import Layout from '../components/Layout.vue';
import Skeleton from '../components/ui/Skeleton.vue';

const { t } = useI18n({ useScope: 'global' });
const route = useRoute();
const systemStore = useSystemStore();
const uiStore = useUIStore();
const instanceStore = useSnapclientInstancesStore();

type ServerService = 'snapserver' | 'shairport-sync' | 'snapmanager';
const activeService = ref<string>('snapserver');
const logs = ref('');
const autoRefresh = ref(false);
let refreshInterval: number | null = null;

const fetchLogs = async () => {
  try {
    if (activeService.value.startsWith('snapclient-inst-')) {
      const id = activeService.value.replace('snapclient-', '');
      logs.value = await instanceStore.fetchInstanceLogs(id);
    } else {
      logs.value = await systemStore.getLogs(activeService.value as ServerService);
    }
  } catch (err: any) {
    uiStore.showToast(t('logs.fetchFailed'), 'error');
  }
};

const switchService = (service: string) => {
  activeService.value = service;
  fetchLogs();
};

onMounted(async () => {
  // Always load instances when filter=snapclient is requested (client mode nav)
  if (systemStore.installedPackages.snapclient || route.query.filter === 'snapclient') {
    await instanceStore.fetchInstances();
  }
  // Auto-select first snapclient instance when coming from client mode
  if (route.query.filter === 'snapclient' && instanceStore.instances[0]) {
    activeService.value = 'snapclient-' + instanceStore.instances[0].id;
  }
  fetchLogs();
  refreshInterval = window.setInterval(() => {
    if (autoRefresh.value) fetchLogs();
  }, 5000);
});

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval);
});
</script>

<template>
  <Layout>
    <div class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 class="text-3xl font-black text-text-main tracking-tight dark:drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">{{ t('logs.title') }}</h1>
          <p class="text-gray-400 font-medium mt-1">{{ t('logs.subtitle') }}</p>
        </div>
        <div class="flex items-center space-x-4 bg-black/40 p-2 rounded-2xl border border-black/5 dark:border-white/5 shadow-inner backdrop-blur-md">
          <label class="flex items-center cursor-pointer group px-3">
            <div class="relative inline-flex items-center">
              <input type="checkbox" v-model="autoRefresh" class="sr-only peer">
              <div class="w-10 h-5 bg-black/10 dark:bg-white/10 peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all border-black/5 dark:border-white/5 peer-checked:bg-brand-primary rounded-full"></div>
              <span class="ml-3 text-xs font-black text-terminal-muted uppercase tracking-widest group-hover:text-brand-primary transition-colors">{{ t('logs.liveUpdate') }}</span>
            </div>
          </label>
          <div class="h-6 w-px bg-black/10 dark:bg-white/10"></div>
          <button @click="fetchLogs" class="inline-flex items-center px-4 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest group">
            <span class="material-symbols-outlined text-[1.1rem] mr-2 transition-transform" :class="{'animate-spin': autoRefresh, 'group-hover:rotate-180': !autoRefresh}">sync</span>
            {{ t('logs.syncNow') }}
          </button>
        </div>
      </div>

      <!-- Service Selector -->
      <div class="flex flex-wrap gap-2">
        <!-- Server services -->
        <button @click="switchService('snapserver')"
          :class="['flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'snapserver' ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]' : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">router</span>
          <span>{{ t('logs.snapserver') }}</span>
        </button>
        <button @click="switchService('shairport-sync')"
          :class="['flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'shairport-sync' ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]' : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">cast</span>
          <span>{{ t('logs.airplay') }}</span>
        </button>
        <button @click="switchService('snapmanager')"
          :class="['flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'snapmanager' ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]' : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">dashboard_customize</span>
          <span>{{ t('logs.manager') }}</span>
        </button>
        <button v-if="systemStore.installedPackages['mpd']" @click="switchService('mpd')"
          :class="['flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'mpd' ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]' : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">queue_music</span>
          <span>{{ t('logs.mpd') }}</span>
        </button>

        <!-- Snapclient instance buttons (shown when instances exist) -->
        <template v-if="instanceStore.instances.length > 0">
          <div class="w-px h-10 bg-black/10 dark:bg-white/10 self-center mx-1"></div>
          <button v-for="inst in instanceStore.instances" :key="inst.id"
            @click="switchService('snapclient-' + inst.id)"
            :class="['flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
              activeService === 'snapclient-' + inst.id ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]' : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
            <span class="material-symbols-outlined text-[1.1rem]">speaker</span>
            <span>{{ inst.name }}</span>
            <span :class="inst.status === 'active' ? 'bg-[#00ff9d]' : 'bg-[#ff3b30]'" class="w-1.5 h-1.5 rounded-full"></span>
          </button>
        </template>
      </div>

      <div class="bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
        <div class="px-6 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center space-x-3">
          <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">terminal</span>
          <span class="text-sm font-black text-white uppercase tracking-widest">{{ t('logs.consoleOutput') }}</span>
          <span v-if="activeService.startsWith('snapclient-')" class="ml-auto text-[10px] font-mono text-brand-primary">
            snapclient-manager-{{ activeService.replace('snapclient-', '') }}.service
          </span>
        </div>
        <div class="relative group">
          <div class="absolute -inset-0.5 bg-brand-primary/20 blur-xl opacity-0 group-hover:opacity-40 transition duration-1000"></div>
          <div class="relative bg-[#020617]/80 rounded-b-2xl font-mono text-[11px] h-[650px] overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            <!-- Task 35: shaped like several lines of log output rather
                 than a generic block -- a handful of text skeletons with
                 varying widths, since real log lines aren't uniform
                 width, so this reads as "text about to appear" here in
                 the console-output panel rather than a loading blob. -->
            <div v-if="!logs" class="space-y-2">
              <Skeleton v-for="(w, i) in ['85%', '60%', '92%', '45%', '70%', '55%', '80%']" :key="i" variant="text" :width="w" height="11px" />
            </div>
            <div v-else class="space-y-1">
              <div v-for="(line, i) in logs.split('\n')" :key="i" class="flex group/line">
                <span class="w-10 shrink-0 text-white/20 select-none text-right pr-4 font-bold">{{ i + 1 }}</span>
                <pre class="text-gray-300 whitespace-pre-wrap break-all selection:bg-brand-primary/30">{{ line }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Layout>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar { width: 6px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
.scrollbar-thin::-webkit-scrollbar-thumb:hover { background: #475569; }
</style>
