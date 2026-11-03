<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Layout from '../components/Layout.vue';
import PageHeader from '../components/ui/PageHeader.vue';
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
const { t } = useI18n({ useScope: 'global' });

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
    uiStore.showToast(t('pipeSources.deletedToast'), 'success');
    needsRestart.value = true;
  } catch (err: any) {
    uiStore.showToast(err.message || t('pipeSources.deleteFailedToast'), 'error');
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
    const successKey =
      action === 'start' ? 'pipeSources.serviceStarted' : action === 'stop' ? 'pipeSources.serviceStopped' : 'pipeSources.serviceRestarted';
    uiStore.showToast(t(successKey), 'success');
  } catch (err: any) {
    const failedKey =
      action === 'start' ? 'pipeSources.controlFailedStart' : action === 'stop' ? 'pipeSources.controlFailedStop' : 'pipeSources.controlFailedRestart';
    uiStore.showToast(err.message || t(failedKey), 'error');
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
        ? (pipe.enabled ? t('pipeSources.serviceRegeneratedRadioEnabled') : t('pipeSources.serviceRegeneratedRadio'))
        : t('pipeSources.serviceRegeneratedMpd'),
      'success'
    );
  } catch (err: any) {
    uiStore.showToast(err.message || t('pipeSources.regenerateFailed'), 'error');
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
    uiStore.showToast(t('pipeSources.snapserverRestartedToast'), 'success');
    needsRestart.value = false;
  } catch (err: any) {
    uiStore.showToast(err.message || t('pipeSources.restartSnapserverFailedToast'), 'error');
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
  return 'bg-line';
}

function statusLabel(status: string) {
  if (status === 'active') return t('pipeSources.statusActive');
  if (status === 'failed') return t('pipeSources.statusFailed');
  if (status === 'activating') return t('pipeSources.statusActivating');
  if (status === 'inactive') return t('pipeSources.statusInactive');
  return status;
}

function typeLabel(type: PipeSourceType) {
  return type === 'mpd' ? t('pipeSources.typeMpd') : t('pipeSources.typeRadio');
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

      <PageHeader :title="t('pipeSources.title')">
        <template #actions>
          <Button variant="subtle" @click="importModal?.open()">
            <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">download</span>
            {{ t('pipeSources.importExisting') }}
          </Button>
          <Button @click="addEditDialog?.openAdd()">
            <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">add</span>
            {{ t('pipeSources.addSource') }}
          </Button>
        </template>
      </PageHeader>
      <p class="-mt-4 mb-2 text-sm text-text-muted max-w-2xl">
        <i18n-t keypath="pipeSources.subtitle">
          <template #pipePrefix><code class="text-xs bg-inset px-1 rounded">pipe://</code></template>
        </i18n-t>
      </p>

      <!-- Banners -->
      <div v-if="needsRestart || isZombieWarning" class="space-y-2">
        <div v-if="needsRestart" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-info/10 border border-info/30 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-info">info</span>
            <p class="text-sm text-text-main">{{ t('pipeSources.restartBanner') }}</p>
          </div>
          <button @click="restartSnapserver" :disabled="restarting"
            class="px-3 py-1.5 bg-brand-primary hover:bg-brand-primary/85 text-white text-xs rounded-lg font-semibold transition-colors disabled:opacity-50 self-start sm:self-auto">
            {{ restarting ? t('pipeSources.restarting') : t('pipeSources.restartSnapserver') }}
          </button>
        </div>
        <div v-if="isZombieWarning" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-warning/10 border border-warning/30 rounded-xl">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-warning">warning</span>
            <p class="text-sm text-text-main">
              <i18n-t keypath="pipeSources.zombieWarning">
                <template #count><strong>{{ store.zombieCount }}</strong></template>
              </i18n-t>
            </p>
          </div>
          <button @click="restartSnapserver" :disabled="restarting"
            class="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs rounded font-medium transition disabled:opacity-50">
            {{ restarting ? t('pipeSources.restarting') : t('pipeSources.restartSnapserver') }}
          </button>
        </div>
      </div>

      <!-- Zombie healthy -->
      <div v-else-if="store.zombieCount !== null && !isZombieWarning" class="flex items-center gap-2 text-xs text-text-muted">
        <span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
        {{ t('pipeSources.zombieHealthy', { count: store.zombieCount }) }}
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
        <div v-for="n in 2" :key="n" class="bg-brand-surface/80 border border-line rounded-[2rem] p-6 sm:p-8 space-y-4">
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
        class="border border-dashed border-line rounded-lg">
        <EmptyState
          icon="sensors"
          :title="t('pipeSources.emptyTitle')"
          :description="t('pipeSources.emptyDescription')"
        >
          <template #action>
            <Button @click="addEditDialog?.openAdd()">
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">add</span>
              {{ t('pipeSources.addSource') }}
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
                  <h2 class="text-base font-bold text-text-main truncate">{{ pipe.name }}</h2>
                  <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold', typeColor(pipe.type)]">
                    {{ typeLabel(pipe.type) }}
                  </span>
                  <span :class="['px-2 py-0.5 rounded-full text-[10px] font-semibold text-white', statusColor(pipe.status)]">
                    {{ statusLabel(pipe.status) }}
                  </span>
                </div>
                <p v-if="pipe.type === 'radio'" class="text-xs text-text-muted font-mono mt-1 truncate" :title="pipe.url">
                  {{ truncateUrl(pipe.url) }}
                </p>
                <p v-else class="text-xs text-text-muted mt-1">
                  <i18n-t keypath="pipeSources.mpdAudioOutput">
                    <template #path><span class="font-mono">{{ pipe.fifoPath }}</span></template>
                  </i18n-t>
                </p>
              </div>

              <!-- Controls -->
              <div class="flex items-center gap-1 flex-shrink-0">
                <button v-if="pipe.status !== 'active'" @click="control(pipe.id, 'start')"
                  :disabled="controllingId === pipe.id"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-green-600/20 hover:bg-green-600/40 text-success transition disabled:opacity-40" :title="t('pipeSources.start')"
                  :aria-label="`${t('pipeSources.start')} ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">play_arrow</span>
                </button>
                <button v-if="pipe.status === 'active'" @click="control(pipe.id, 'stop')"
                  :disabled="controllingId === pipe.id"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-red-600/20 hover:bg-red-600/40 text-danger transition disabled:opacity-40" :title="t('pipeSources.stop')"
                  :aria-label="`${t('pipeSources.stop')} ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">stop</span>
                </button>
                <button @click="control(pipe.id, 'restart')" :disabled="controllingId === pipe.id"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-line hover:bg-line text-text-main transition disabled:opacity-40" :title="t('pipeSources.restart')"
                  :aria-label="`${t('pipeSources.restart')} ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">restart_alt</span>
                </button>
                <button @click="viewLogs(pipe)"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-line hover:bg-line text-text-main transition" :title="t('pipeSources.viewLogs')"
                  :aria-label="`${t('pipeSources.viewLogsFor')} ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">terminal</span>
                </button>
                <button @click="confirmDelete(pipe.id)"
                  class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center rounded bg-line hover:bg-red-600/30 text-text-muted hover:text-danger transition" :title="t('pipeSources.delete')"
                  :aria-label="`${t('pipeSources.delete')} ${pipe.name}`">
                  <span class="material-symbols-outlined text-[1rem]">delete</span>
                </button>
              </div>
            </div>
          </template>

          <!-- Details -->
          <div class="mt-3 space-y-2 text-xs text-text-muted">
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="font-mono">
                <i18n-t keypath="pipeSources.fifoLabel">
                  <template #value><span class="text-text-muted">{{ pipe.fifoPath }}</span></template>
                </i18n-t>
              </span>
              <span class="font-mono">
                <i18n-t keypath="pipeSources.serviceLabel">
                  <template #value><span class="text-text-muted">{{ pipe.serviceName }}</span></template>
                </i18n-t>
              </span>
            </div>
            <div v-if="pipe.type === 'radio'" class="flex flex-wrap gap-2 mt-1">
              <span v-if="pipe.reconnect" class="px-2 py-0.5 bg-inset rounded text-text-muted">reconnect</span>
              <span v-if="pipe.reconnectStreamed" class="px-2 py-0.5 bg-inset rounded text-text-muted">reconnect_streamed</span>
              <span v-if="pipe.reconnectAtEof" class="px-2 py-0.5 bg-inset rounded text-text-muted">reconnect_at_eof</span>
              <span class="px-2 py-0.5 bg-inset rounded text-text-muted">delay_max={{ pipe.reconnectDelayMax }}s</span>
              <span class="px-2 py-0.5 bg-inset rounded text-text-muted">idle={{ pipe.idleThreshold }}ms</span>
            </div>
            <div v-else class="flex flex-wrap gap-2 mt-1">
              <span class="px-2 py-0.5 bg-inset rounded text-text-muted">idle={{ pipe.idleThreshold }}ms</span>
              <span class="px-2 py-0.5 bg-blue-900/40 rounded text-blue-400">{{ t('pipeSources.writesViaMpdConf') }}</span>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-line flex flex-wrap gap-2">
            <button @click="addEditDialog?.openEdit(pipe)"
              class="px-3 py-1.5 rounded bg-inset hover:bg-line text-text-main text-xs font-medium transition flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[1rem]">edit</span>
              {{ t('pipeSources.editSettings') }}
            </button>
            <button @click="regenerateService(pipe)" :disabled="regeneratingId === pipe.id"
              class="px-3 py-1.5 rounded bg-purple-600/20 hover:bg-purple-600/35 text-purple-300 text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[1rem]" :class="{ 'animate-spin': regeneratingId === pipe.id }">sync</span>
              {{ regeneratingId === pipe.id ? t('pipeSources.regenerating') : (pipe.type === 'radio' ? t('pipeSources.regenerateService') : t('pipeSources.regenerateMpd')) }}
            </button>
            <button @click="configEditorModal?.open(pipe)"
              class="px-3 py-1.5 rounded bg-amber-600/15 hover:bg-amber-600/30 text-amber-300 text-xs font-medium transition flex items-center gap-1.5">
              <span class="material-symbols-outlined text-[1rem]">description</span>
              {{ pipe.type === 'radio' ? t('pipeSources.serviceFile') : t('pipeSources.mpdBlock') }}
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
      :title="t('pipeSources.deleteDialogTitle')"
      :message="t('pipeSources.deleteDialogMessage')"
      :confirm-text="t('pipeSources.delete')"
      type="danger"
      @confirm="handleDelete"
    />
  </Layout>
</template>
