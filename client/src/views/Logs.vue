<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useSystemStore } from '../stores/system';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const systemStore = useSystemStore();
const activeService = ref<'snapserver' | 'shairport-sync' | 'snapmanager'>('snapserver');
const logs = ref('');
const autoRefresh = ref(true);
let refreshInterval: number | null = null;

const fetchLogs = async () => {
  logs.value = await systemStore.getLogs(activeService.value);
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
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">System Logs</h1>
        <div class="flex items-center space-x-2">
          <label class="flex items-center cursor-pointer">
            <input type="checkbox" v-model="autoRefresh" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mr-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">Auto-refresh (5s)</span>
          </label>
          <button @click="fetchLogs" class="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm">
            Refresh Now
          </button>
        </div>
      </div>

      <div class="flex space-x-2">
        <button 
          v-for="service in ['snapserver', 'shairport-sync', 'snapmanager']" 
          :key="service"
          @click="switchService(service)"
          :class="[
            'px-4 py-2 rounded-md text-sm font-medium transition-colors',
            activeService === service 
              ? 'bg-indigo-600 text-white' 
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
          ]"
        >
          {{ service }}
        </button>
      </div>

      <Card :title="`Logs for ${activeService}`">
        <div class="bg-black text-green-400 p-4 rounded-md font-mono text-xs h-[600px] overflow-y-auto whitespace-pre-wrap">
          {{ logs || 'Loading logs...' }}
        </div>
      </Card>
    </div>
  </Layout>
</template>
