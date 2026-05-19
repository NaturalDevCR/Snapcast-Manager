<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { usePipeSourcesStore, type PipeSource, type PipeSourceFormData, type PipeSourceType, type DiscoveredPipe, type AdoptInput } from '../stores/pipeSources';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';

const store = usePipeSourcesStore();
const uiStore = useUIStore();

// ---- polling ----
let pollInterval: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await store.fetchPipes();
  await store.fetchZombieCount();
  pollInterval = setInterval(async () => {
    await store.fetchPipes();
    await store.fetchZombieCount();
  }, 8000);
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});

// ---- dialog state ----
const showDialog = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const needsRestart = ref(false);

const defaultForm = (): PipeSourceFormData => ({
  name: '',
  type: 'radio',
  url: '',
  reconnect: true,
  reconnectStreamed: true,
  reconnectAtEof: true,
  reconnectDelayMax: 30,
  idleThreshold: 15000,
  enabled: true,
});

const form = ref<PipeSourceFormData>(defaultForm());

function openAdd() {
  editingId.value = null;
  form.value = defaultForm();
  showDialog.value = true;
}

function openEdit(pipe: PipeSource) {
  editingId.value = pipe.id;
  form.value = {
    name: pipe.name,
    type: pipe.type,
    url: pipe.url,
    reconnect: pipe.reconnect,
    reconnectStreamed: pipe.reconnectStreamed,
    reconnectAtEof: pipe.reconnectAtEof,
    reconnectDelayMax: pipe.reconnectDelayMax,
    idleThreshold: pipe.idleThreshold,
    enabled: pipe.enabled,
  };
  showDialog.value = true;
}

function closeDialog() {
  showDialog.value = false;
  editingId.value = null;
}

async function saveDialog() {
  if (!form.value.name.trim()) {
    uiStore.showToast('Name is required', 'error');
    return;
  }
  if (form.value.type === 'radio' && !form.value.url.trim()) {
    uiStore.showToast('Stream URL is required for Radio sources', 'error');
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await store.updatePipe(editingId.value, form.value);
      uiStore.showToast('Source updated. Restart snapserver to apply changes.', 'success');
    } else {
      await store.createPipe(form.value);
      uiStore.showToast('Source created. Restart snapserver to apply changes.', 'success');
    }
    needsRestart.value = true;
    closeDialog();
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to save', 'error');
  } finally {
    saving.value = false;
  }
}

// ---- delete ----
const showConfirmDelete = ref(false);
const deletingId = ref<string | null>(null);

function confirmDelete(id: string) {
  deletingId.value = id;
  showConfirmDelete.value = true;
}

async function handleDelete() {
  if (!deletingId.value) return;
  try {
    await store.deletePipe(deletingId.value);
    uiStore.showToast('Source deleted. Restart snapserver to apply changes.', 'success');
    needsRestart.value = true;
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to delete', 'error');
  } finally {
    showConfirmDelete.value = false;
    deletingId.value = null;
  }
}

// ---- service control ----
const controllingId = ref<string | null>(null);

async function control(id: string, action: 'start' | 'stop' | 'restart') {
  controllingId.value = id;
  try {
    await store.controlPipe(id, action);
    uiStore.showToast(`Service ${action}ed`, 'success');
  } catch (err: any) {
    uiStore.showToast(err.message || `Failed to ${action}`, 'error');
  } finally {
    controllingId.value = null;
  }
}

// ---- snapserver restart ----
const restarting = ref(false);

async function restartSnapserver() {
  restarting.value = true;
  try {
    await fetchApi('/system/service/restart/snapserver', { method: 'POST' });
    uiStore.showToast('Snapserver restarted', 'success');
    needsRestart.value = false;
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to restart snapserver', 'error');
  } finally {
    restarting.value = false;
  }
}

// ---- config editor ----
const showConfigEditor = ref(false);
const configEditorPipe = ref<PipeSource | null>(null);
const configContent = ref('');
const configFilePath = ref('');
const loadingConfig = ref(false);
const savingConfig = ref(false);

async function openConfigEditor(pipe: PipeSource) {
  configEditorPipe.value = pipe;
  configContent.value = '';
  configFilePath.value = '';
  showConfigEditor.value = true;
  loadingConfig.value = true;
  try {
    const result = await store.getConfig(pipe.id);
    configContent.value = result.content;
    configFilePath.value = result.filePath;
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to load config', 'error');
    showConfigEditor.value = false;
  } finally {
    loadingConfig.value = false;
  }
}

async function saveConfigEditor() {
  if (!configEditorPipe.value) return;
  savingConfig.value = true;
  try {
    await store.setConfig(configEditorPipe.value.id, configContent.value);
    uiStore.showToast('Config saved and service restarted', 'success');
    showConfigEditor.value = false;
    await store.fetchPipes();
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to save config', 'error');
  } finally {
    savingConfig.value = false;
  }
}

// ---- logs ----
const showLogs = ref(false);
const logsContent = ref('');
const logsTitle = ref('');
const loadingLogs = ref(false);

async function viewLogs(pipe: PipeSource) {
  logsTitle.value = pipe.type === 'mpd' ? `${pipe.name} (mpd service)` : pipe.name;
  logsContent.value = '';
  showLogs.value = true;
  loadingLogs.value = true;
  try {
    logsContent.value = await store.getLogs(pipe.id);
  } catch (err: any) {
    logsContent.value = `Error loading logs: ${err.message}`;
  } finally {
    loadingLogs.value = false;
  }
}

// ---- discover & import ----
const showImportModal = ref(false);
const discovering = ref(false);
const discovered = ref<DiscoveredPipe[]>([]);

type ImportForm = {
  type: PipeSourceType;
  url: string;
  reconnect: boolean;
  reconnectStreamed: boolean;
  reconnectAtEof: boolean;
  reconnectDelayMax: number;
  adopting: boolean;
  adopted: boolean;
};

const importForms = ref<Record<string, ImportForm>>({});

async function openImportModal() {
  showImportModal.value = true;
  discovering.value = true;
  discovered.value = [];
  importForms.value = {};
  try {
    discovered.value = await store.discoverPipes();
    for (const d of discovered.value) {
      const svc = d.existingService;
      importForms.value[d.fifoPath] = {
        type: d.detectedType,
        url: svc?.url ?? '',
        reconnect: svc?.reconnect ?? true,
        reconnectStreamed: svc?.reconnectStreamed ?? true,
        reconnectAtEof: svc?.reconnectAtEof ?? true,
        reconnectDelayMax: svc?.reconnectDelayMax ?? 30,
        adopting: false,
        adopted: false,
      };
    }
  } catch (err: any) {
    uiStore.showToast(err.message || 'Discovery failed', 'error');
  } finally {
    discovering.value = false;
  }
}

async function adoptPipe(d: DiscoveredPipe) {
  const f = importForms.value[d.fifoPath];
  if (!f) return;
  if (f.type === 'radio' && !f.url.trim()) {
    uiStore.showToast('Stream URL is required for Radio sources', 'error');
    return;
  }
  f.adopting = true;
  try {
    const input: AdoptInput = {
      name: d.name,
      type: f.type,
      url: f.url.trim(),
      reconnect: f.reconnect,
      reconnectStreamed: f.reconnectStreamed,
      reconnectAtEof: f.reconnectAtEof,
      reconnectDelayMax: f.reconnectDelayMax,
      idleThreshold: d.idleThreshold,
      enabled: true,
      existingServiceName: d.existingService?.name,
    };
    await store.adoptPipe(input);
    f.adopted = true;
    uiStore.showToast(`${d.name} imported`, 'success');
  } catch (err: any) {
    uiStore.showToast(err.message || 'Import failed', 'error');
  } finally {
    f.adopting = false;
  }
}

const discoveredWithForms = computed(() =>
  discovered.value
    .map(d => ({ d, f: importForms.value[d.fifoPath] }))
    .filter((x): x is { d: DiscoveredPipe; f: ImportForm } => x.f !== undefined)
);

const pendingDiscovered = computed(() => discoveredWithForms.value.filter(({ f }) => !f.adopted).map(({ d }) => d));

// ---- helpers ----
function statusColor(status: string) {
  if (status === 'active') return 'bg-green-500';
  if (status === 'failed') return 'bg-red-500';
  if (status === 'activating') return 'bg-yellow-500';
  return 'bg-zinc-600';
}

function statusLabel(status: string) {
  if (status === 'active') return 'Running';
  if (status === 'failed') return 'Failed';
  if (status === 'activating') return 'Starting';
  if (status === 'inactive') return 'Stopped';
  return status;
}

function typeLabel(type: PipeSourceType) {
  return type === 'mpd' ? 'MPD' : 'Radio';
}

function typeColor(type: PipeSourceType) {
  return type === 'mpd' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300';
}

function truncateUrl(url: string, max = 52) {
  return url.length > max ? url.slice(0, max) + '…' : url;
}

const isZombieWarning = computed(() => (store.zombieCount ?? 0) > 100);
</script>

<template>
  <Layout>
    <div class="space-y-6">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            Pipe Sources
          </h1>
          <p class="text-zinc-400 mt-1 text-sm">
            Managed <code class="text-xs bg-zinc-800 px-1 rounded">pipe://</code> sources for snapserver —
            Radio streams via systemd + ffmpeg, MPD outputs via mpd.conf.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="openImportModal"
            class="px-4 py-2 border border-zinc-700 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm font-medium transition flex items-center gap-2"
          >
            <span class="material-symbols-outlined text-[1rem]">download</span>
            Import Existing
          </button>
          <button
            @click="openAdd"
            class="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded hover:opacity-90 text-sm font-medium shadow transition flex items-center gap-2"
          >
            <span class="material-symbols-outlined text-[1rem]">add</span>
            Add Source
          </button>
        </div>
      </div>

      <!-- Banners -->
      <div v-if="needsRestart || isZombieWarning" class="space-y-2">
        <div v-if="needsRestart" class="flex items-center justify-between p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-blue-400">info</span>
            <p class="text-sm text-blue-300">Config changed — restart snapserver to load the new sources.</p>
          </div>
          <button @click="restartSnapserver" :disabled="restarting"
            class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded font-medium transition disabled:opacity-50">
            {{ restarting ? 'Restarting…' : 'Restart Snapserver' }}
          </button>
        </div>
        <div v-if="isZombieWarning" class="flex items-center justify-between p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-orange-400">warning</span>
            <p class="text-sm text-orange-300">
              <strong>{{ store.zombieCount }}</strong> zombie processes detected. Restart snapserver to clear them.
            </p>
          </div>
          <button @click="restartSnapserver" :disabled="restarting"
            class="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded font-medium transition disabled:opacity-50">
            {{ restarting ? 'Restarting…' : 'Restart Snapserver' }}
          </button>
        </div>
      </div>

      <!-- Zombie healthy -->
      <div v-else-if="store.zombieCount !== null && !isZombieWarning" class="flex items-center gap-2 text-xs text-zinc-500">
        <span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
        {{ store.zombieCount }} zombie processes — system healthy
      </div>

      <!-- Empty state -->
      <div v-if="!store.loading && store.pipes.length === 0"
        class="text-center py-16 border border-dashed border-zinc-800 rounded-lg">
        <span class="material-symbols-outlined text-4xl text-zinc-700 mb-3 block">sensors</span>
        <p class="text-zinc-500">No pipe sources configured.</p>
        <p class="text-zinc-600 text-sm mt-1">Add a Radio or MPD source to replace your
          <code class="text-xs bg-zinc-800 px-1 rounded">process://</code> entries.</p>
      </div>

      <!-- Source cards -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card v-for="pipe in store.pipes" :key="pipe.id" class="relative">
          <template #header>
            <div class="flex items-start justify-between w-full gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-base font-bold text-zinc-200 truncate">{{ pipe.name }}</h2>
                  <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold', typeColor(pipe.type)]">
                    {{ typeLabel(pipe.type) }}
                  </span>
                  <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold text-white', statusColor(pipe.status)]">
                    {{ statusLabel(pipe.status) }}
                  </span>
                </div>
                <p v-if="pipe.type === 'radio'" class="text-xs text-zinc-500 font-mono mt-1 truncate" :title="pipe.url">
                  {{ truncateUrl(pipe.url) }}
                </p>
                <p v-else class="text-xs text-zinc-500 mt-1">MPD audio output → <span class="font-mono">{{ pipe.fifoPath }}</span></p>
              </div>

              <!-- Controls -->
              <div class="flex items-center gap-1 flex-shrink-0">
                <button v-if="pipe.status !== 'active'" @click="control(pipe.id, 'start')"
                  :disabled="controllingId === pipe.id"
                  class="p-1.5 rounded bg-green-600/20 hover:bg-green-600/40 text-green-400 transition disabled:opacity-40" title="Start">
                  <span class="material-symbols-outlined text-[1rem]">play_arrow</span>
                </button>
                <button v-if="pipe.status === 'active'" @click="control(pipe.id, 'stop')"
                  :disabled="controllingId === pipe.id"
                  class="p-1.5 rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 transition disabled:opacity-40" title="Stop">
                  <span class="material-symbols-outlined text-[1rem]">stop</span>
                </button>
                <button @click="control(pipe.id, 'restart')" :disabled="controllingId === pipe.id"
                  class="p-1.5 rounded bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-300 transition disabled:opacity-40" title="Restart">
                  <span class="material-symbols-outlined text-[1rem]">restart_alt</span>
                </button>
                <button @click="viewLogs(pipe)"
                  class="p-1.5 rounded bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-300 transition" title="View Logs">
                  <span class="material-symbols-outlined text-[1rem]">terminal</span>
                </button>
                <button @click="openConfigEditor(pipe)"
                  class="p-1.5 rounded bg-zinc-700/50 hover:bg-amber-600/30 text-zinc-300 hover:text-amber-400 transition" title="Edit Service File">
                  <span class="material-symbols-outlined text-[1rem]">description</span>
                </button>
                <button @click="openEdit(pipe)"
                  class="p-1.5 rounded bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-300 transition" title="Edit">
                  <span class="material-symbols-outlined text-[1rem]">edit</span>
                </button>
                <button @click="confirmDelete(pipe.id)"
                  class="p-1.5 rounded bg-zinc-700/50 hover:bg-red-600/30 text-zinc-500 hover:text-red-400 transition" title="Delete">
                  <span class="material-symbols-outlined text-[1rem]">delete</span>
                </button>
              </div>
            </div>
          </template>

          <!-- Details -->
          <div class="mt-3 space-y-2 text-xs text-zinc-500">
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="font-mono">FIFO: <span class="text-zinc-400">{{ pipe.fifoPath }}</span></span>
              <span class="font-mono">Service: <span class="text-zinc-400">{{ pipe.serviceName }}</span></span>
            </div>
            <div v-if="pipe.type === 'radio'" class="flex flex-wrap gap-2 mt-1">
              <span v-if="pipe.reconnect" class="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">reconnect</span>
              <span v-if="pipe.reconnectStreamed" class="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">reconnect_streamed</span>
              <span v-if="pipe.reconnectAtEof" class="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">reconnect_at_eof</span>
              <span class="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">delay_max={{ pipe.reconnectDelayMax }}s</span>
              <span class="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">idle={{ pipe.idleThreshold }}ms</span>
            </div>
            <div v-else class="flex flex-wrap gap-2 mt-1">
              <span class="px-2 py-0.5 bg-zinc-800 rounded text-zinc-400">idle={{ pipe.idleThreshold }}ms</span>
              <span class="px-2 py-0.5 bg-blue-900/40 rounded text-blue-400">Writes via mpd.conf</span>
            </div>
          </div>
        </Card>
      </div>

    </div>

    <!-- Add / Edit Dialog -->
    <Teleport to="body">
      <div v-if="showDialog" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div class="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full shadow-2xl">
          <h3 class="text-lg font-bold text-zinc-200 mb-5">
            {{ editingId ? 'Edit Pipe Source' : 'Add Pipe Source' }}
          </h3>

          <div class="space-y-4">
            <!-- Type selector -->
            <div>
              <label class="block text-xs text-zinc-400 mb-2">Source Type</label>
              <div class="flex gap-2">
                <button
                  @click="form.type = 'radio'"
                  :disabled="!!editingId"
                  :class="['flex-1 py-2 rounded border text-sm font-medium transition', form.type === 'radio' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600']"
                >
                  <span class="material-symbols-outlined text-[1rem] mr-1 align-middle">radio</span>
                  Radio Stream
                </button>
                <button
                  @click="form.type = 'mpd'"
                  :disabled="!!editingId"
                  :class="['flex-1 py-2 rounded border text-sm font-medium transition', form.type === 'mpd' ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600']"
                >
                  <span class="material-symbols-outlined text-[1rem] mr-1 align-middle">music_note</span>
                  MPD Output
                </button>
              </div>
              <p v-if="editingId" class="text-xs text-zinc-600 mt-1">Type cannot be changed after creation.</p>
              <p v-else-if="form.type === 'radio'" class="text-xs text-zinc-600 mt-1">ffmpeg pulls from an HTTP stream URL and writes to the FIFO.</p>
              <p v-else class="text-xs text-zinc-600 mt-1">MPD writes audio to the FIFO via an audio_output block in mpd.conf.</p>
            </div>

            <!-- Name -->
            <div>
              <label class="block text-xs text-zinc-400 mb-1">Display Name <span class="text-red-400">*</span></label>
              <input
                v-model="form.name"
                type="text"
                placeholder="e.g. Radio Gym"
                class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none"
              />
              <p v-if="editingId" class="text-xs text-zinc-600 mt-1">Renaming will migrate the FIFO path and recreate the service file automatically.</p>
            </div>

            <!-- Radio-only fields -->
            <template v-if="form.type === 'radio'">
              <div>
                <label class="block text-xs text-zinc-400 mb-1">Stream URL <span class="text-red-400">*</span></label>
                <input
                  v-model="form.url"
                  type="url"
                  placeholder="https://your-server.com/listen/station/radio.mp3"
                  class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs text-zinc-400 mb-2">ffmpeg Reconnect Options</label>
                <div class="space-y-2 pl-1">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" v-model="form.reconnect" class="rounded border-zinc-600 bg-zinc-800 text-purple-500 focus:ring-purple-500" />
                    <span class="text-sm text-zinc-300"><code class="text-xs bg-zinc-800 px-1 rounded">-reconnect</code> — reconnect on network errors</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" v-model="form.reconnectStreamed" class="rounded border-zinc-600 bg-zinc-800 text-purple-500 focus:ring-purple-500" />
                    <span class="text-sm text-zinc-300"><code class="text-xs bg-zinc-800 px-1 rounded">-reconnect_streamed</code> — reconnect on stream interrupts</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" v-model="form.reconnectAtEof" class="rounded border-zinc-600 bg-zinc-800 text-purple-500 focus:ring-purple-500" />
                    <span class="text-sm text-zinc-300"><code class="text-xs bg-zinc-800 px-1 rounded">-reconnect_at_eof</code> — reconnect on HTTP EOF (needed for AzuraCast)</span>
                  </label>
                </div>
              </div>

              <div>
                <label class="block text-xs text-zinc-400 mb-1">Reconnect Delay Max (s)</label>
                <input v-model.number="form.reconnectDelayMax" type="number" min="1" max="300"
                  class="w-32 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none" />
              </div>
            </template>

            <!-- MPD info -->
            <div v-else class="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-blue-300 space-y-1">
              <p class="font-medium">MPD audio_output block will be added to mpd.conf:</p>
              <pre class="text-[10px] text-zinc-400 bg-zinc-900 rounded p-2 leading-4">audio_output {
  type    "fifo"
  name    "{{ form.name || 'Your Source Name' }}"
  path    "/tmp/snapfifo_{{ (form.name || 'name').toLowerCase().replace(/[^a-z0-9]+/g, '_') }}"
  format  "48000:16:2"
}</pre>
            </div>

            <!-- Idle threshold (both types) -->
            <div>
              <label class="block text-xs text-zinc-400 mb-1">Idle Threshold (ms)</label>
              <input v-model.number="form.idleThreshold" type="number" min="1000" max="60000"
                class="w-32 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:border-purple-500 focus:outline-none" />
              <p class="text-xs text-zinc-600 mt-1">How long silence before snapserver marks the source idle.</p>
            </div>

            <!-- Enabled toggle -->
            <label class="flex items-center gap-3 cursor-pointer">
              <button @click="form.enabled = !form.enabled"
                :class="form.enabled ? 'bg-purple-600' : 'bg-zinc-700'"
                class="relative inline-flex h-5 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200">
                <span :class="form.enabled ? 'translate-x-5' : 'translate-x-0'"
                  class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200"></span>
              </button>
              <span class="text-sm text-zinc-300">Enable on save</span>
            </label>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button @click="closeDialog" class="px-4 py-2 border border-zinc-700 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm transition">
              Cancel
            </button>
            <button @click="saveDialog" :disabled="saving"
              class="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white rounded hover:opacity-90 text-sm font-medium transition disabled:opacity-50">
              {{ saving ? 'Saving…' : (editingId ? 'Update' : 'Create') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Logs Modal -->
    <Teleport to="body">
      <div v-if="showLogs" class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div class="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl">
          <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <h3 class="text-sm font-semibold text-zinc-200">
              <span class="material-symbols-outlined text-[1rem] mr-1 align-middle">terminal</span>
              Logs — {{ logsTitle }}
            </h3>
            <button @click="showLogs = false" class="text-zinc-500 hover:text-zinc-300 transition">
              <span class="material-symbols-outlined text-[1.2rem]">close</span>
            </button>
          </div>
          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="loadingLogs" class="text-zinc-500 text-sm text-center py-8">Loading logs…</div>
            <pre v-else class="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-5">{{ logsContent || 'No log output.' }}</pre>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Import Existing Modal -->
    <Teleport to="body">
      <div v-if="showImportModal" class="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-start justify-center z-50 p-4 pt-16 overflow-y-auto">
        <div class="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl shadow-2xl mb-8">
          <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <div>
              <h3 class="text-base font-bold text-zinc-200">Import Existing Pipe Sources</h3>
              <p class="text-xs text-zinc-500 mt-0.5">Discovers unmanaged <code class="bg-zinc-800 px-1 rounded">pipe://</code> sources in snapserver.conf and adopts them.</p>
            </div>
            <button @click="showImportModal = false" class="text-zinc-500 hover:text-zinc-300 transition">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>

          <div class="p-6 space-y-4">
            <div v-if="discovering" class="text-center py-8 text-zinc-500 text-sm">
              <span class="material-symbols-outlined animate-spin inline-block mr-2 text-[1.2rem]">refresh</span>
              Scanning snapserver config…
            </div>
            <div v-else-if="discovered.length === 0" class="text-center py-8 text-zinc-500 text-sm">
              <span class="material-symbols-outlined text-3xl block mb-2 text-zinc-700">check_circle</span>
              No unmanaged pipe:// sources found.
            </div>
            <div v-else-if="pendingDiscovered.length === 0" class="text-center py-8 text-zinc-500 text-sm">
              <span class="material-symbols-outlined text-3xl block mb-2 text-green-600">check_circle</span>
              All discovered sources have been imported.
            </div>

            <div v-for="{ d, f } in discoveredWithForms" :key="d.fifoPath" class="border border-zinc-800 rounded-lg overflow-hidden">
              <!-- Item header -->
              <div :class="['px-4 py-3 flex items-center justify-between', f.adopted ? 'bg-green-500/10' : 'bg-zinc-800/50']">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-sm text-zinc-200">{{ d.name }}</span>
                    <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold', f.type === 'mpd' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300']">
                      {{ f.type === 'mpd' ? 'MPD' : 'Radio' }}
                    </span>
                    <span v-if="f.adopted" class="text-xs text-green-400 font-medium">Imported</span>
                  </div>
                  <span class="text-xs font-mono text-zinc-500">{{ d.fifoPath }}</span>
                </div>
                <div v-if="d.existingService" class="text-right">
                  <span class="text-xs text-zinc-500">{{ d.existingService.name }}</span>
                  <span :class="['ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold', d.existingService.isActive ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400']">
                    {{ d.existingService.isActive ? 'active' : 'inactive' }}
                  </span>
                </div>
              </div>

              <!-- Form -->
              <div v-if="!f.adopted" class="px-4 py-4 space-y-3">
                <!-- Type override -->
                <div class="flex gap-2">
                  <button @click="f.type = 'radio'"
                    :class="['flex-1 py-1.5 rounded border text-xs font-medium transition', f.type === 'radio' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600']">
                    Radio
                  </button>
                  <button @click="f.type = 'mpd'"
                    :class="['flex-1 py-1.5 rounded border text-xs font-medium transition', f.type === 'mpd' ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600']">
                    MPD
                  </button>
                </div>

                <!-- Radio fields -->
                <template v-if="f.type === 'radio'">
                  <div>
                    <label class="block text-xs text-zinc-400 mb-1">Stream URL <span class="text-red-400">*</span></label>
                    <input v-model="f.url" type="url" placeholder="https://…/radio.mp3"
                      class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono focus:border-purple-500 focus:outline-none" />
                    <p v-if="d.existingService?.url" class="text-[10px] text-zinc-600 mt-1">Auto-detected from existing service.</p>
                  </div>
                  <div class="flex flex-wrap gap-x-4 gap-y-2 items-center">
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-300">
                      <input type="checkbox" v-model="f.reconnect" class="rounded border-zinc-600 bg-zinc-800 text-purple-500" />
                      reconnect
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-300">
                      <input type="checkbox" v-model="f.reconnectStreamed" class="rounded border-zinc-600 bg-zinc-800 text-purple-500" />
                      reconnect_streamed
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-300">
                      <input type="checkbox" v-model="f.reconnectAtEof" class="rounded border-zinc-600 bg-zinc-800 text-purple-500" />
                      reconnect_at_eof
                    </label>
                    <div class="flex items-center gap-2 text-xs text-zinc-400">
                      delay_max
                      <input v-model.number="f.reconnectDelayMax" type="number" min="1" max="300"
                        class="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-purple-500 focus:outline-none" />s
                    </div>
                  </div>
                </template>

                <!-- MPD info -->
                <div v-else class="text-xs text-blue-300 bg-blue-500/5 border border-blue-500/20 rounded p-3">
                  This FIFO was detected in mpd.conf. It will be registered as an MPD source — no service changes needed.
                </div>

                <div class="flex justify-end">
                  <button @click="adoptPipe(d)" :disabled="f.adopting"
                    class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded font-medium transition disabled:opacity-50 flex items-center gap-2">
                    <span v-if="f.adopting" class="material-symbols-outlined animate-spin text-[1rem]">refresh</span>
                    {{ f.adopting ? 'Importing…' : 'Import' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="px-6 py-4 border-t border-zinc-800 flex justify-end">
            <button @click="showImportModal = false" class="px-4 py-2 border border-zinc-700 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm transition">
              Close
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Config File Editor Modal -->
    <Teleport to="body">
      <div v-if="showConfigEditor" class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div class="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl" style="max-height: 85vh;">
          <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-shrink-0">
            <div>
              <h3 class="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <span class="material-symbols-outlined text-[1rem] text-amber-400">description</span>
                {{ configEditorPipe?.type === 'mpd' ? 'MPD audio_output block' : 'Systemd Service File' }}
                — {{ configEditorPipe?.name }}
              </h3>
              <p class="text-xs text-zinc-500 mt-0.5 font-mono">{{ configFilePath }}</p>
            </div>
            <button @click="showConfigEditor = false" class="text-zinc-500 hover:text-zinc-300 transition">
              <span class="material-symbols-outlined text-[1.2rem]">close</span>
            </button>
          </div>

          <div class="flex-1 overflow-hidden flex flex-col p-4 gap-3 min-h-0">
            <div v-if="loadingConfig" class="text-zinc-500 text-sm text-center py-8">Loading…</div>
            <template v-else>
              <p v-if="configEditorPipe?.type === 'mpd'" class="text-xs text-blue-300 bg-blue-500/5 border border-blue-500/20 rounded px-3 py-2">
                Editing only the <code>audio_output</code> block managed by Snapcast Manager. Other mpd.conf content is preserved.
              </p>
              <p v-else class="text-xs text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2">
                Changes are written directly to the service file and trigger a <code>daemon-reload</code> + restart. Be careful with syntax.
              </p>
              <textarea
                v-model="configContent"
                spellcheck="false"
                class="flex-1 w-full bg-zinc-900 border border-zinc-700 rounded px-4 py-3 text-xs text-zinc-200 font-mono leading-5 focus:border-amber-500 focus:outline-none resize-none min-h-0"
                style="min-height: 300px;"
              ></textarea>
            </template>
          </div>

          <div class="flex justify-end gap-3 px-5 py-4 border-t border-zinc-800 flex-shrink-0">
            <button @click="showConfigEditor = false" class="px-4 py-2 border border-zinc-700 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm transition">
              Cancel
            </button>
            <button @click="saveConfigEditor" :disabled="savingConfig || loadingConfig"
              class="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-medium transition disabled:opacity-50 flex items-center gap-2">
              <span v-if="savingConfig" class="material-symbols-outlined animate-spin text-[1rem]">refresh</span>
              {{ savingConfig ? 'Saving…' : 'Save & Restart Service' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Confirm Delete -->
    <ConfirmDialog
      v-model="showConfirmDelete"
      title="Delete Pipe Source"
      message="This will stop the service, remove config entries (systemd service file or mpd.conf block), and remove the source from snapserver config. This cannot be undone."
      confirm-text="Delete"
      type="danger"
      @confirm="handleDelete"
    />
  </Layout>
</template>
