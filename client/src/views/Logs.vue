<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import { 
    CommandLineIcon, 
    ArrowPathIcon, 
    ServerIcon, 
    SpeakerWaveIcon, 
    ShieldCheckIcon 
} from '@heroicons/vue/24/outline';

const systemStore = useSystemStore();
const uiStore = useUIStore();
const activeService = ref<'snapserver' | 'shairport-sync' | 'snapmanager'>('snapserver');
const logs = ref('');
const autoRefresh = ref(true);
let refreshInterval: number | null = null;

const fetchLogs = async () => {
    try {
        logs.value = await systemStore.getLogs(activeService.value);
    } catch (err: any) {
        uiStore.showToast(`Failed to fetch ${activeService.value} logs`, 'error');
    }
};

const switchService = (service: any) => {
  activeService.value = service;
  fetchLogs();
};

onMounted(() => {
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
      <!-- Header Section -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 class="text-3xl font-black text-slate-900 dark:text-white tracking-tight">System Logs</h1>
          <p class="text-slate-500 dark:text-slate-400 font-medium">Real-time surveillance of your services.</p>
        </div>
        
        <div class="flex items-center space-x-4 bg-white dark:bg-slate-800 p-2 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <label class="flex items-center cursor-pointer group px-3">
            <div class="relative inline-flex items-center">
                <input type="checkbox" v-model="autoRefresh" class="sr-only peer">
                <div class="w-10 h-5 bg-slate-200 peer-focus:outline-none dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600 rounded-full"></div>
                <span class="ml-3 text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest group-hover:text-indigo-600 transition-colors">Live Update</span>
            </div>
          </label>
          <div class="h-6 w-px bg-slate-200 dark:bg-slate-700"></div>
          <button @click="fetchLogs" class="inline-flex items-center px-4 py-1.5 text-xs font-black text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest">
            <ArrowPathIcon class="h-4 w-4 mr-2" :class="{'animate-spin': autoRefresh}" />
            Sync Now
          </button>
        </div>
      </div>

      <!-- Service Selector -->
      <div class="flex flex-wrap gap-2">
        <button 
          @click="switchService('snapserver')"
          :class="[
            'flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300',
            activeService === 'snapserver' 
              ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20 translate-y-[-2px]' 
              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-indigo-500/50'
          ]"
        >
          <ServerIcon class="h-4 w-4" />
          <span>Snapserver</span>
        </button>
        <button 
          @click="switchService('shairport-sync')"
          :class="[
            'flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300',
            activeService === 'shairport-sync' 
              ? 'bg-orange-600 text-white shadow-xl shadow-orange-500/20 translate-y-[-2px]' 
              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-orange-500/50'
          ]"
        >
          <SpeakerWaveIcon class="h-4 w-4" />
          <span>AirPlay</span>
        </button>
        <button 
          @click="switchService('snapmanager')"
          :class="[
            'flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300',
            activeService === 'snapmanager' 
              ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-500/20 translate-y-[-2px]' 
              : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-emerald-500/50'
          ]"
        >
          <ShieldCheckIcon class="h-4 w-4" />
          <span>Manager</span>
        </button>
      </div>

      <Card>
        <template #title>
            <div class="flex items-center space-x-3">
                <CommandLineIcon class="h-5 w-5 text-slate-400" />
                <span class="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest">Console Output</span>
            </div>
        </template>
        <div class="relative group">
            <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-10 group-hover:opacity-15 transition duration-1000"></div>
            <div class="relative bg-slate-900 dark:bg-[#020617] rounded-xl font-mono text-[11px] h-[650px] overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              <div v-if="!logs" class="flex flex-col items-center justify-center h-full space-y-4">
                  <ArrowPathIcon class="h-8 w-8 text-slate-700 animate-spin" />
                  <p class="text-slate-600 font-black uppercase tracking-[0.2em]">Intercepting Logs...</p>
              </div>
              <div v-else class="space-y-1">
                  <div v-for="(line, i) in logs.split('\n')" :key="i" class="flex group/line">
                      <span class="w-10 shrink-0 text-slate-700 select-none text-right pr-4 font-bold">{{ i + 1 }}</span>
                      <pre class="text-slate-300 whitespace-pre-wrap break-all selection:bg-indigo-500/30">{{ line }}</pre>
                  </div>
              </div>
            </div>
        </div>
      </Card>
    </div>
  </Layout>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 10px;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: #475569;
}
</style>
