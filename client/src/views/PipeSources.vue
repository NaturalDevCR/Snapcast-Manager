<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Button from '../components/ui/Button.vue';
import Skeleton from '../components/ui/Skeleton.vue';
import LogsModal from '../components/pipe-sources/LogsModal.vue';
import ImportModal from '../components/pipe-sources/ImportModal.vue';
import ConfigEditorModal from '../components/pipe-sources/ConfigEditorModal.vue';
import AddEditPipeDialog from '../components/pipe-sources/AddEditPipeDialog.vue';
import { usePipeSourcesStore, type PipeSource, type PipeSourceType } from '../stores/pipeSources';
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
// Task 42: moved into AddEditPipeDialog.vue -- this view only needs a
// template ref to imperatively open it (see addEditDialog.value?.openAdd()
// / .openEdit(pipe) below). `needsRestart` stays HERE, though: it's a
// page-level banner set by three different flows (this dialog's save, the
// delete flow below, and restartSnapserver() itself), not owned by the
// dialog -- so the dialog emits `saved` and this handler updates the flag,
// mirroring Task 38's SnapshotsPanel.vue `restored` emit exactly.
const needsRestart = ref(false);

function handleDialogSaved({ snapserverConfigChanged }: { snapserverConfigChanged: boolean }) {
  needsRestart.value = needsRestart.value || snapserverConfigChanged;
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
    uiStore.showToast('Source deleted and service removed. Restart snapserver to unload it.', 'success');
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
const regeneratingId = ref<string | null>(null);

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

async function regenerateService(pipe: PipeSource) {
  regeneratingId.value = pipe.id;
  try {
    await store.regenerateService(pipe.id);
    uiStore.showToast(
      pipe.type === 'radio'
        ? (pipe.enabled ? 'Service file regenerated and radio service restarted' : 'Service file regenerated')
        : 'MPD output regenerated and mpd restarted',
      'success'
    );
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to regenerate service', 'error');
  } finally {
    regeneratingId.value = null;
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
// Task 41: moved into ConfigEditorModal.vue -- this view only needs a
// template ref to imperatively open it for a given pipe (see
// configEditorModal.value?.open(pipe) below).
const configEditorModal = ref<InstanceType<typeof ConfigEditorModal> | null>(null);

// ---- add/edit dialog ----
// Task 42: moved into AddEditPipeDialog.vue -- see the `needsRestart`
// comment above for why the flag itself stays here.
const addEditDialog = ref<InstanceType<typeof AddEditPipeDialog> | null>(null);

// ---- logs ----
// Task 39: moved into LogsModal.vue -- this view only needs a template ref
// to imperatively open it for a given pipe (see logsModal.open(pipe) below).
const logsModal = ref<InstanceType<typeof LogsModal> | null>(null);

function viewLogs(pipe: PipeSource) {
  logsModal.value?.open(pipe);
}

// ---- discover & import ----
// Task 40: moved into ImportModal.vue -- this view only needs a template
// ref to imperatively open it (see importModal.value?.open() below).
const importModal = ref<InstanceType<typeof ImportModal> | null>(null);

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
            @click="importModal?.open()"
            class="px-4 py-2 border border-zinc-700 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm font-medium transition flex items-center gap-2"
          >
            <span class="material-symbols-outlined text-[1rem]">download</span>
            Import Existing
          </button>
          <button
            @click="addEditDialog?.openAdd()"
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
      <div v-else-if="store.zombieCount !== null && !isZombieWarning" class="flex items-center gap-2 text-xs text-zinc-400">
        <span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
        {{ store.zombieCount }} zombie processes — system healthy
      </div>

      <!-- Loading state (Task 35): initial fetchPipes() still in flight and
           nothing to show yet -- shaped like a couple of the Card-based
           pipe-source rows below (same grid, a title-width text bar + two
           badge-width bars in the header, a couple of detail-line bars
           underneath) so it reads as "source cards about to appear"
           instead of a generic block. Must never show at the same time as
           EmptyState below (that's for a CONFIRMED empty list, not "still
           loading") -- v-else-if on the empty-state branch guarantees
           that. -->
      <div v-if="store.loading && store.pipes.length === 0"
        class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div v-for="n in 2" :key="n" class="bg-brand-surface/80 border border-white/[0.04] rounded-[2rem] p-6 sm:p-8 space-y-4">
          <div class="flex items-center gap-2">
            <Skeleton variant="text" width="40%" height="20px" />
            <Skeleton variant="text" width="15%" height="18px" />
            <Skeleton variant="text" width="15%" height="18px" />
          </div>
          <Skeleton variant="text" width="60%" height="12px" />
          <div class="flex gap-4">
            <Skeleton variant="text" width="30%" height="10px" />
            <Skeleton variant="text" width="30%" height="10px" />
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="store.pipes.length === 0"
        class="border border-dashed border-zinc-800 rounded-lg">
        <EmptyState
          icon="sensors"
          title="No pipe sources configured"
          description="Add a Radio or MPD source to replace your process:// entries."
        >
          <template #action>
            <Button @click="addEditDialog?.openAdd()">
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">add</span>
              Add Source
            </Button>
          </template>
        </EmptyState>
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
                <p v-if="pipe.type === 'radio'" class="text-xs text-zinc-400 font-mono mt-1 truncate" :title="pipe.url">
                  {{ truncateUrl(pipe.url) }}
                </p>
                <p v-else class="text-xs text-zinc-400 mt-1">MPD audio output → <span class="font-mono">{{ pipe.fifoPath }}</span></p>
              </div>

              <!-- Controls -->
              <div class="flex items-center gap-1 flex-shrink-0">
                <button v-if="pipe.status !== 'active'" @click="control(pipe.id, 'start')"
                  :disabled="controllingId === pipe.id"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-green-600/20 hover:bg-green-600/40 text-green-400 transition disabled:opacity-40" title="Start"
                  :aria-label="`Start ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">play_arrow</span>
                </button>
                <button v-if="pipe.status === 'active'" @click="control(pipe.id, 'stop')"
                  :disabled="controllingId === pipe.id"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 transition disabled:opacity-40" title="Stop"
                  :aria-label="`Stop ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">stop</span>
                </button>
                <button @click="control(pipe.id, 'restart')" :disabled="controllingId === pipe.id"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-300 transition disabled:opacity-40" title="Restart"
                  :aria-label="`Restart ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">restart_alt</span>
                </button>
                <button @click="viewLogs(pipe)"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-300 transition" title="View Logs"
                  :aria-label="`View logs for ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">terminal</span>
                </button>
                <button @click="confirmDelete(pipe.id)"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-zinc-700/50 hover:bg-red-600/30 text-zinc-500 hover:text-red-400 transition" title="Delete"
                  :aria-label="`Delete ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">delete</span>
                </button>
              </div>
            </div>
          </template>

          <!-- Details -->
          <div class="mt-3 space-y-2 text-xs text-zinc-400">
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

          <div class="mt-4 pt-3 border-t border-zinc-800/80 flex flex-wrap gap-2">
            <button @click="addEditDialog?.openEdit(pipe)"
              class="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[1rem]">edit</span>
              Edit settings
            </button>
            <button @click="regenerateService(pipe)" :disabled="regeneratingId === pipe.id"
              class="px-3 py-1.5 rounded bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[1rem]" :class="{ 'animate-spin': regeneratingId === pipe.id }">sync</span>
              {{ regeneratingId === pipe.id ? 'Regenerating...' : (pipe.type === 'radio' ? 'Regenerate service' : 'Regenerate MPD') }}
            </button>
            <button @click="configEditorModal?.open(pipe)"
              class="px-3 py-1.5 rounded bg-amber-600/15 hover:bg-amber-600/30 text-amber-300 text-xs font-medium transition flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[1rem]">description</span>
              {{ pipe.type === 'radio' ? 'Service file' : 'MPD block' }}
            </button>
          </div>
        </Card>
      </div>

    </div>

    <!-- Add / Edit Dialog (Task 42: extracted into AddEditPipeDialog.vue) -->
    <AddEditPipeDialog ref="addEditDialog" @saved="handleDialogSaved" />

    <!-- Logs Modal (Task 39: extracted into LogsModal.vue) -->
    <LogsModal ref="logsModal" />

    <!-- Import Existing Modal (Task 40: extracted into ImportModal.vue) -->
    <ImportModal ref="importModal" />

    <!-- Config File Editor Modal (Task 41: extracted into ConfigEditorModal.vue) -->
    <ConfigEditorModal ref="configEditorModal" />

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
