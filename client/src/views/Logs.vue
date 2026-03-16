<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import Layout from '../components/Layout.vue';

const systemStore = useSystemStore();
const uiStore = useUIStore();
const activeService = ref<'snapserver' | 'shairport-sync' | 'snapmanager'>('snapserver');
const logs = ref('');
const autoRefresh = ref(false);
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
          <h1 class="text-3xl font-black text-white tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">System Logs</h1>
          <p class="text-gray-400 font-medium mt-1">Real-time surveillance of your services.</p>
        </div>
        
        <div class="flex items-center space-x-4 bg-black/40 p-2 rounded-2xl border border-white/5 shadow-inner backdrop-blur-md">
          <label class="flex items-center cursor-pointer group px-3">
            <div class="relative inline-flex items-center">
                <input type="checkbox" v-model="autoRefresh" class="sr-only peer">
                <div class="w-10 h-5 bg-white/10 peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all border-white/5 peer-checked:bg-brand-primary rounded-full"></div>
                <span class="ml-3 text-xs font-black text-gray-500 uppercase tracking-widest group-hover:text-brand-primary transition-colors">Live Update</span>
            </div>
          </label>
          <div class="h-6 w-px bg-white/10"></div>
          <button @click="fetchLogs" class="inline-flex items-center px-4 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest group">
            <span class="material-symbols-outlined text-[1.1rem] mr-2 transition-transform" :class="{'animate-spin': autoRefresh, 'group-hover:rotate-180': !autoRefresh}">sync</span>
            Sync Now
          </button>
        </div>
      </div>

      <!-- Service Selector -->
      <div class="flex flex-wrap gap-2">
        <button 
          @click="switchService('snapserver')"
          :class="[
            'flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'snapserver' 
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.3)]' 
              : 'bg-black/40 text-gray-500 border-white/5 hover:border-brand-primary/30 hover:text-gray-300'
          ]"
        >
          <span class="material-symbols-outlined text-[1.1rem]">router</span>
          <span>Snapserver</span>
        </button>
        <button 
          @click="switchService('shairport-sync')"
          :class="[
            'flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'shairport-sync' 
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.3)]' 
              : 'bg-black/40 text-gray-500 border-white/5 hover:border-brand-primary/30 hover:text-gray-300'
          ]"
        >
          <span class="material-symbols-outlined text-[1.1rem]">cast</span>
          <span>AirPlay</span>
        </button>
        <button 
          @click="switchService('snapmanager')"
          :class="[
            'flex items-center space-x-3 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeService === 'snapmanager' 
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.3)]' 
              : 'bg-black/40 text-gray-500 border-white/5 hover:border-brand-primary/30 hover:text-gray-300'
          ]"
        >
          <span class="material-symbols-outlined text-[1.1rem]">dashboard_customize</span>
          <span>Manager</span>
        </button>
      </div>

      <div class="bg-black/40 border border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
        <div class="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center space-x-3">
            <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">terminal</span>
            <span class="text-sm font-black text-white uppercase tracking-widest">Console Output</span>
        </div>
        <div class="relative group">
            <div class="absolute -inset-0.5 bg-brand-primary/20 blur-xl opacity-0 group-hover:opacity-40 transition duration-1000"></div>
            <div class="relative bg-[#020617]/80 rounded-b-2xl font-mono text-[11px] h-[650px] overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              <div v-if="!logs" class="flex flex-col items-center justify-center h-full space-y-4">
                  <span class="material-symbols-outlined text-gray-600 animate-spin text-[3rem]">sync</span>
                  <p class="text-gray-500 font-black uppercase tracking-[0.2em]">Intercepting Logs...</p>
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
