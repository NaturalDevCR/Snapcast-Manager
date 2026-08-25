<script setup lang="ts">
// Task 42: extracted from PipeSources.vue -- the sixth and final slice of
// decomposing that view onto smaller, self-contained child components
// (Task 38 did ServerConfig.vue's Snapshots tab, Tasks 39-41 did this same
// view's Logs, Import, and Config Editor modals; see
// .superpowers/sdd/task-42-brief.md). This is PipeSources.vue's last
// remaining modal.
//
// Unlike Tasks 39-41, this dialog has ONE genuine piece of cross-cutting
// state: `needsRestart`. That flag is a page-level "restart snapserver"
// banner set by THREE flows (this dialog's save, the delete flow, and the
// snapserver-restart handler itself) -- only one of which lives here -- so
// it CANNOT move into this component. Instead this component emits
// `saved` with whether the save touched snapserver-relevant config, and
// the parent (which still owns `needsRestart`) updates its own ref from
// that payload. Mirrors Task 38's `restored` emit from
// server-config/SnapshotsPanel.vue exactly.
//
// Two open modes (add vs. edit-with-a-pipe) are exposed as two distinct
// methods -- openAdd() and openEdit(pipe) -- reachable via the same
// template ref, matching how the two are already separate functions/call
// sites in the parent today.
import { ref } from 'vue';
import { Dialog, DialogPanel, TransitionChild, TransitionRoot } from '@headlessui/vue';
import { usePipeSourcesStore, type PipeSource, type PipeSourceFormData } from '../../stores/pipeSources';
import { useUIStore } from '../../stores/ui';

const emit = defineEmits<{ saved: [{ snapserverConfigChanged: boolean }] }>();

const store = usePipeSourcesStore();
const uiStore = useUIStore();

const showDialog = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);

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
      const existingPipe = store.pipes.find(p => p.id === editingId.value);
      const snapserverConfigChanged = !!existingPipe && (
        existingPipe.name !== form.value.name ||
        existingPipe.type !== form.value.type ||
        existingPipe.idleThreshold !== form.value.idleThreshold
      );
      await store.updatePipe(editingId.value, form.value);
      uiStore.showToast(
        snapserverConfigChanged
          ? 'Source updated and service config applied. Restart snapserver to load source changes.'
          : 'Source updated and service config applied',
        'success'
      );
      emit('saved', { snapserverConfigChanged });
    } else {
      await store.createPipe(form.value);
      uiStore.showToast('Source created and service config applied. Restart snapserver to load it.', 'success');
      emit('saved', { snapserverConfigChanged: true });
    }
    closeDialog();
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to save', 'error');
  } finally {
    saving.value = false;
  }
}

defineExpose({ openAdd, openEdit });
</script>

<template>
  <TransitionRoot as="template" :show="showDialog">
    <Dialog as="div" class="relative z-50" @close="closeDialog">
      <TransitionChild
        as="template"
        enter="ease-out duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-200"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      </TransitionChild>

      <div class="fixed inset-0 z-10 flex items-center justify-center p-4">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="ease-in duration-200"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel class="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-lg w-full shadow-2xl">
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
            <p v-if="editingId" class="text-xs text-zinc-400 mt-1">Type cannot be changed after creation.</p>
            <p v-else-if="form.type === 'radio'" class="text-xs text-zinc-400 mt-1">ffmpeg pulls from an HTTP stream URL and writes to the FIFO.</p>
            <p v-else class="text-xs text-zinc-400 mt-1">MPD writes audio to the FIFO via an audio_output block in mpd.conf.</p>
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
            <p v-if="editingId" class="text-xs text-zinc-400 mt-1">Renaming will migrate the FIFO path and recreate the service file automatically.</p>
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
            <p class="text-xs text-zinc-400 mt-1">How long silence before snapserver marks the source idle.</p>
          </div>

          <!-- Enabled toggle -->
          <label class="flex items-center gap-3 cursor-pointer">
            <button @click="form.enabled = !form.enabled"
              :class="form.enabled ? 'bg-purple-600' : 'bg-zinc-700'"
              class="relative inline-flex h-5 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200"
              :aria-label="form.enabled ? 'Disable on save' : 'Enable on save'">
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
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
