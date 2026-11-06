<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWatchdogStore } from '../stores/watchdog';
import { useUIStore } from '../stores/ui';
import Layout from '../components/Layout.vue';
import Modal from '../components/ui/Modal.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import Card from '../components/Card.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Button from '../components/ui/Button.vue';
import { createCodeEditor, type CodeEditor } from '../utils/codeEditor';

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
let editorInstance: CodeEditor | null = null;
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
        const value = JSON.stringify(watchdogStore.watchdogs, null, 2);
        if (editorInstance?.container.isConnected) {
           editorInstance.setOptions({ value });
        } else if (editorRef.value) {
           editorInstance = createCodeEditor(editorRef.value, { value, language: 'json' });
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
      <PageHeader :title="t('watchdogs.title')" :description="t('watchdogs.subtitle')">
        <template #actions>
          <Button variant="subtle" @click="showExpertMode = true">
            <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">code</span>
            {{ t('watchdogs.manualEdit') }}
          </Button>
          <Button @click="showAddDialog = true">
            <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">add</span>
            {{ t('watchdogs.addWatchdog') }}
          </Button>
        </template>
      </PageHeader>

      <!-- Empty State -->
      <div v-if="watchdogStore.watchdogs.length === 0" class="border border-dashed border-line rounded-2xl bg-brand-surface/50">
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
        <!-- Card has no #header slot: this used #header, so each watchdog's
             name, enable toggle and delete button silently never rendered. -->
        <Card v-for="wd in watchdogStore.watchdogs" :key="wd.id">
          <template #icon><span class="material-symbols-outlined text-[1.2rem]">monitor_heart</span></template>
          <template #title>
            <h2 class="text-sm font-bold text-text-main truncate">{{ wd.name }}</h2>
            <p class="text-xs text-text-muted">{{ t('watchdogs.portsLabel') }}: {{ wd.ports?.join(', ') || t('watchdogs.none') }}</p>
            <p v-if="wd.autoKillDuplicates" class="text-xs text-info mt-0.5">{{ t('watchdogs.autoCleanupEnabled') }}</p>
          </template>
          <template #action>
            <button
              type="button"
              role="switch"
              :aria-checked="!!wd.enabled"
              :aria-label="`${wd.enabled ? t('watchdogs.disable') : t('watchdogs.enable')} ${wd.name}`"
              :class="wd.enabled ? 'bg-brand-primary' : 'bg-line'"
              class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
              @click="toggleEnabled(wd)"
            >
              <span :class="wd.enabled ? 'translate-x-6' : 'translate-x-1'" class="pointer-events-none inline-block h-4 w-4 mt-1 transform rounded-full bg-white shadow transition-transform"></span>
            </button>
            <button @click="confirmDelete(wd.id)" class="w-9 h-9 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors flex items-center justify-center" :aria-label="`${t('watchdogs.delete')} ${wd.name}`">
              <span class="material-symbols-outlined text-[1.15rem]" aria-hidden="true">delete</span>
            </button>
          </template>

          <!-- Stats List -->
          <div v-if="wd.enabled" class="space-y-3 mt-2">
             <div v-if="!watchdogStore.stats[wd.id] || watchdogStore.stats[wd.id]?.length === 0" class="text-xs text-text-muted py-2">
                 {{ t('watchdogs.noActiveConnections') }}
             </div>
             <div v-else class="max-h-60 overflow-y-auto space-y-2">
                 <div v-for="(stat, sIdx) in watchdogStore.stats[wd.id]" :key="sIdx" class="p-3 bg-inset border border-line rounded-xl flex items-center justify-between gap-3 text-sm">
                     <div class="space-y-1">
                         <div class="flex items-center space-x-2">
                             <span :class="stat.state === 'ESTAB' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'" class="px-2 py-0.5 rounded text-xs font-mono">
                                 {{ stat.state }}
                             </span>
                             <span class="font-medium text-text-main">{{ stat.peerAddress }}:{{ stat.peerPort }}</span>
                         </div>
                         <div class="text-xs text-text-muted flex space-x-3 font-mono">
                             <span v-if="stat.rxBytes !== undefined">{{ t('watchdogs.recv') }}: {{ formatBytes(stat.rxBytes) }}</span>
                             <span v-if="stat.recvQ !== undefined">{{ t('watchdogs.queueLabel') }}: {{ stat.recvQ }}</span>
                         </div>
                     </div>
                     <button v-if="stat.state === 'ESTAB'" @click="disconnectSocket(wd.id, stat.peerAddress, stat.peerPort)" class="text-danger text-xs font-semibold px-2.5 py-1 rounded-lg bg-danger/10 border border-danger/20 hover:bg-danger/15 transition-colors">
                         {{ t('watchdogs.kill') }}
                     </button>
                 </div>
             </div>
          </div>
          <div v-else class="text-center py-4 text-xs text-text-muted">
             {{ t('watchdogs.disabled') }}
          </div>
        </Card>
      </div>

      <Modal v-model="showAddDialog" :title="t('watchdogs.addDialogTitle')">
        <div class="space-y-4">
          <div>
            <label for="wd-name" class="block text-xs font-semibold text-text-muted mb-1.5">{{ t('watchdogs.nameLabel') }}</label>
            <input id="wd-name" v-model="newWatchdog.name" type="text" class="w-full bg-inset border border-line rounded-xl px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary" :placeholder="t('watchdogs.namePlaceholder')" />
          </div>
          <fieldset>
            <legend class="block text-xs font-semibold text-text-muted mb-1.5">{{ t('watchdogs.targetSourcesLabel') }}</legend>
            <div class="space-y-1 max-h-40 overflow-y-auto border border-line rounded-xl p-2 bg-inset">
              <label v-for="source in sources" :key="source.port" class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-line cursor-pointer">
                <input type="checkbox" :value="source.port" v-model="selectedPorts" class="rounded accent-brand-primary">
                <span class="text-sm text-text-main">{{ source.name }} <span class="text-text-muted">(:{{ source.port }})</span></span>
              </label>
            </div>
          </fieldset>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="autoKillDuplicates" class="rounded accent-brand-primary">
            <span class="text-sm text-text-main">{{ t('watchdogs.autoKillDuplicatesLabel') }}</span>
          </label>
        </div>
        <template #footer>
          <Button variant="ghost" @click="showAddDialog = false">{{ t('watchdogs.cancel') }}</Button>
          <Button @click="handleAddWatchdog">{{ t('watchdogs.create') }}</Button>
        </template>
      </Modal>

      <!-- Expert Mode Dialog -->
      <div v-if="showExpertMode" class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" @keydown.esc="showExpertMode = false">
         <div class="bg-brand-surface border border-line rounded-2xl shadow-2xl p-6 max-w-2xl w-full flex flex-col h-3/4">
             <div class="flex items-center justify-between mb-4">
                 <h3 class="text-lg font-bold text-text-main">{{ t('watchdogs.manualJsonTitle') }}</h3>
                 <span v-if="jsonError" class="text-xs text-danger">{{ jsonError }}</span>
             </div>
             <div ref="editorRef" class="code-editor-host flex-1 border border-line rounded-xl overflow-hidden text-sm"></div>
             <div class="flex justify-end space-x-3 mt-4">
                 <Button variant="ghost" @click="showExpertMode = false">{{ t('watchdogs.cancel') }}</Button>
                 <Button @click="saveExpertMode">{{ t('watchdogs.saveChanges') }}</Button>
             </div>
         </div>
      </div>

      <!-- Was `v-if` + `@cancel` on a v-model-driven dialog: it mounted with
           modelValue undefined, so the delete confirmation never opened. -->
      <ConfirmDialog v-model="showConfirmDelete" type="danger" :title="t('watchdogs.deleteDialogTitle')" :message="t('watchdogs.deleteDialogMessage')" :confirm-text="t('watchdogs.delete')" :cancel-text="t('watchdogs.cancel')" @confirm="handleDelete" />
    </div>
  </Layout>
</template>

<style scoped>
/* Scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line); border-radius: 2px; }
</style>
