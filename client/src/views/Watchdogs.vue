<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWatchdogStore } from '../stores/watchdog';
import { useUIStore } from '../stores/ui';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Button from '../components/ui/Button.vue';
import { basicEditor } from 'prism-code-editor/setups';
import 'prism-code-editor/prism/languages/json';
import 'prism-code-editor/layout.css';
import 'prism-code-editor/themes/github-dark.css';
import 'prism-code-editor/themes/github-light.css';

const watchdogStore = useWatchdogStore();
const uiStore = useUIStore();
const { t } = useI18n({ useScope: 'global' });

const showAddDialog = ref(false);
const showExpertMode = ref(false);
const showConfirmDelete = ref(false);
const watchdogToDelete = ref<string | null>(null);

const sources = ref<{ name: string; port: number }[]>([]);
const selectedPorts = ref<number[]>([]);
const autoKillDuplicates = ref(false);

const newWatchdog = ref({
  name: '',
  description: ''
});

const editorRef = ref<HTMLElement | null>(null);
let editorInstance: any = null;
const jsonError = ref('');

// Polling intervals
let statsInterval: any = null;

onMounted(async () => {
  await watchdogStore.fetchWatchdogs();
  sources.value = await watchdogStore.fetchSources();
  startPolling();
});

onUnmounted(() => {
  stopPolling();
});

function startPolling() {
  stopPolling();
  statsInterval = setInterval(() => {
    watchdogStore.watchdogs.forEach(w => {
      if (w.enabled) watchdogStore.fetchStats(w.id);
    });
  }, 3000); // every 3 seconds
}

function stopPolling() {
  if (statsInterval) clearInterval(statsInterval);
}

async function handleAddWatchdog() {
  try {
    if (!newWatchdog.value.name || selectedPorts.value.length === 0) return;
    await watchdogStore.addWatchdog({
      name: newWatchdog.value.name,
      ports: selectedPorts.value,
      description: newWatchdog.value.description,
      autoKillDuplicates: autoKillDuplicates.value
    });
    newWatchdog.value = { name: '', description: '' };
    selectedPorts.value = [];
    autoKillDuplicates.value = false;
    showAddDialog.value = false;
    uiStore.showToast(t('watchdogs.addedToast'), 'success');
  } catch (error: any) {
    uiStore.showToast(error.message, 'error');
  }
}

function confirmDelete(id: string) {
  watchdogToDelete.value = id;
  showConfirmDelete.value = true;
}

async function handleDelete() {
  if (!watchdogToDelete.value) return;
  try {
    await watchdogStore.deleteWatchdog(watchdogToDelete.value);
    showConfirmDelete.value = false;
    watchdogToDelete.value = null;
    uiStore.showToast(t('watchdogs.deletedToast'), 'success');
  } catch (error: any) {
    uiStore.showToast(error.message, 'error');
  }
}

async function toggleEnabled(watchdog: any) {
  try {
    await watchdogStore.updateWatchdog(watchdog.id, { enabled: !watchdog.enabled });
  } catch (error: any) {
    uiStore.showToast(error.message, 'error');
  }
}

async function disconnectSocket(watchdogId: string, peerIp: string, peerPort: number) {
  try {
    await watchdogStore.disconnectSocket(watchdogId, peerIp, peerPort);
    uiStore.showToast(t('watchdogs.socketDisconnectedToast'), 'success');
  } catch (error: any) {
    uiStore.showToast(error.message, 'error');
  }
}

// Expert Mode (Manual edit JSON)
watch(showExpertMode, (val) => {
  if (val) {
     setTimeout(() => {
        if (editorRef.value && !editorInstance) {
           editorInstance = basicEditor(editorRef.value, {
              value: JSON.stringify(watchdogStore.watchdogs, null, 2),
              language: 'json',
              theme: uiStore.isDark ? 'github-dark' : 'github-light'
           });
        } else if (editorInstance) {
           editorInstance.setOptions({ value: JSON.stringify(watchdogStore.watchdogs, null, 2) });
        }
     }, 100);
  }
});

async function saveExpertMode() {
   if (!editorInstance) return;
   try {
      const parsed = JSON.parse(editorInstance.value);
      if (!Array.isArray(parsed)) throw new Error(t('watchdogs.mustBeArray'));
      await watchdogStore.bulkUpdateWatchdogs(parsed);
      showExpertMode.value = false;
      uiStore.showToast(t('watchdogs.configurationSavedToast'), 'success');
   } catch (e: any) {
      jsonError.value = e.message || t('watchdogs.invalidJson');
   }
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (bytes === 0) return '0 B';
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
</script>

<template>
  <Layout>
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">{{ t('watchdogs.title') }}</h1>
          <p class="text-zinc-400 mt-1">{{ t('watchdogs.subtitle') }}</p>
        </div>
        <div class="flex space-x-3">
          <button @click="showExpertMode = true" class="px-4 py-2 border border-zinc-700 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm font-medium transition flex items-center">
            {{ t('watchdogs.manualEdit') }}
          </button>
          <button @click="showAddDialog = true" class="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded hover:opacity-90 text-sm font-medium shadow transition flex items-center">
            <span>{{ t('watchdogs.addWatchdog') }}</span>
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="watchdogStore.watchdogs.length === 0" class="border border-dashed border-zinc-800 rounded-lg">
        <EmptyState
          icon="monitor_heart"
          :title="t('watchdogs.emptyTitle')"
          :description="t('watchdogs.emptyDescription')"
        >
          <template #action>
            <Button @click="showAddDialog = true">
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">add</span>
              {{ t('watchdogs.addWatchdog') }}
            </Button>
          </template>
        </EmptyState>
      </div>

      <!-- Watchdog Grids -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card v-for="wd in watchdogStore.watchdogs" :key="wd.id" class="relative group">
          <template #header>
            <div class="flex items-center justify-between w-full">
               <div>
<h2 class="text-lg font-bold text-zinc-200">{{ wd.name }}</h2>
                   <p class="text-xs text-zinc-400">{{ t('watchdogs.portsLabel') }}: {{ wd.ports?.join(', ') || t('watchdogs.none') }}</p>
                   <p v-if="wd.autoKillDuplicates" class="text-xs text-blue-400 mt-0.5">{{ t('watchdogs.autoCleanupEnabled') }}</p>
               </div>
               <div class="flex items-center space-x-2">
                  <!-- Toggle -->
                  <button @click="toggleEnabled(wd)" :class="[wd.enabled ? 'bg-green-600' : 'bg-zinc-700']" class="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out" :aria-label="`${wd.enabled ? t('watchdogs.disable') : t('watchdogs.enable')} ${wd.name}`">
                    <span :class="[wd.enabled ? 'translate-x-5' : 'translate-x-0']" class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"></span>
                  </button>
                  <button @click="confirmDelete(wd.id)" class="text-zinc-500 hover:text-red-400 transition min-w-[40px] min-h-[40px] flex items-center justify-center" :aria-label="`${t('watchdogs.delete')} ${wd.name}`">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6M1 7h22M10 11H1h18M8 4h8" /></svg>
                  </button>
               </div>
            </div>
          </template>

          <!-- Stats List -->
          <div v-if="wd.enabled" class="space-y-3 mt-2">
             <div v-if="!watchdogStore.stats[wd.id] || watchdogStore.stats[wd.id]?.length === 0" class="text-xs text-zinc-400 py-2">
                 {{ t('watchdogs.noActiveConnections') }}
             </div>
             <div v-else class="max-h-60 overflow-y-auto space-y-2">
                 <div v-for="(stat, sIdx) in watchdogStore.stats[wd.id]" :key="sIdx" class="p-3 bg-zinc-900 border border-zinc-800 rounded-md flex items-center justify-between text-sm">
                     <div class="space-y-1">
                         <div class="flex items-center space-x-2">
                             <span :class="stat.state === 'ESTAB' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-500'" class="px-2 py-0.5 rounded text-xs font-mono">
                                 {{ stat.state }}
                             </span>
                             <span class="font-medium text-zinc-300">{{ stat.peerAddress }}:{{ stat.peerPort }}</span>
                         </div>
                         <div class="text-xs text-zinc-400 flex space-x-3 font-mono">
                             <span v-if="stat.rxBytes !== undefined">⬇️ {{ t('watchdogs.recv') }}: {{ formatBytes(stat.rxBytes) }}</span>
                             <span v-if="stat.recvQ !== undefined">{{ t('watchdogs.queueLabel') }}: {{ stat.recvQ }}</span>
                         </div>
                     </div>
                     <button v-if="stat.state === 'ESTAB'" @click="disconnectSocket(wd.id, stat.peerAddress, stat.peerPort)" class="text-red-500 hover:text-red-400 text-xs px-2 py-1 rounded bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition">
                         {{ t('watchdogs.kill') }}
                     </button>
                 </div>
             </div>
          </div>
          <div v-else class="text-center py-4 text-xs text-zinc-400">
             {{ t('watchdogs.disabled') }}
          </div>
        </Card>
      </div>

      <!-- Add Dialog modal placeholder or standalone mock -->
      <div v-if="showAddDialog" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
         <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full animate-fadeIn">
             <h3 class="text-lg font-bold text-zinc-200 mb-4">{{ t('watchdogs.addDialogTitle') }}</h3>
             <div class="space-y-4">
                 <div>
                     <label class="block text-xs text-zinc-400 mb-1">{{ t('watchdogs.nameLabel') }}</label>
                     <input v-model="newWatchdog.name" type="text" class="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-sm text-zinc-200" :placeholder="t('watchdogs.namePlaceholder')" />
                 </div>
                  <div>
                      <label class="block text-xs text-zinc-400 mb-2">{{ t('watchdogs.targetSourcesLabel') }}</label>
                      <div class="space-y-2 max-h-40 overflow-y-auto border border-zinc-800 rounded p-2 bg-zinc-950">
                          <div v-for="source in sources" :key="source.port" class="flex items-center space-x-2">
                              <input type="checkbox" :value="source.port" v-model="selectedPorts" class="rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-blue-500">
                              <span class="text-sm text-zinc-300">{{ source.name }} <span class="text-zinc-400">(:{{ source.port }})</span></span>
                          </div>
                      </div>
                  </div>
                  <div class="flex items-center space-x-2 mt-2">
                      <input type="checkbox" v-model="autoKillDuplicates" id="autoKill" class="rounded border-zinc-700 bg-zinc-800 text-blue-600 focus:ring-blue-500">
                      <label for="autoKill" class="text-xs text-zinc-400">{{ t('watchdogs.autoKillDuplicatesLabel') }}</label>
                  </div>
             </div>
             <div class="flex justify-end space-x-3 mt-6">
                 <button @click="showAddDialog = false" class="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200">{{ t('watchdogs.cancel') }}</button>
                 <button @click="handleAddWatchdog" class="px-4 py-2 bg-blue-600 text-white rounded text-xs hover:bg-blue-500">{{ t('watchdogs.create') }}</button>
             </div>
         </div>
      </div>

      <!-- Expert Mode Dialog -->
      <div v-if="showExpertMode" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
         <div class="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-2xl w-full flex flex-col h-3/4 animate-fadeIn">
             <div class="flex items-center justify-between mb-4">
                 <h3 class="text-lg font-bold text-zinc-200">{{ t('watchdogs.manualJsonTitle') }}</h3>
                 <span v-if="jsonError" class="text-xs text-red-500">{{ jsonError }}</span>
             </div>
             <div ref="editorRef" class="flex-1 bg-zinc-950 border border-zinc-800 rounded p-2 overflow-hidden font-mono text-sm"></div>
             <div class="flex justify-end space-x-3 mt-4">
                 <button @click="showExpertMode = false" class="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200">{{ t('watchdogs.cancel') }}</button>
                 <button @click="saveExpertMode" class="px-4 py-2 bg-blue-600 text-white rounded text-xs hover:bg-blue-500">{{ t('watchdogs.saveChanges') }}</button>
             </div>
         </div>
      </div>

      <ConfirmDialog v-if="showConfirmDelete" :title="t('watchdogs.deleteDialogTitle')" :message="t('watchdogs.deleteDialogMessage')" @confirm="handleDelete" @cancel="showConfirmDelete = false" />
    </div>
  </Layout>
</template>

<style scoped>
/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
</style>
