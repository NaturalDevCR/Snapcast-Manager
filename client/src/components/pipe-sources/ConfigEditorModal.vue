<script setup lang="ts">
// Task 41: extracted from PipeSources.vue -- the fourth slice of
// decomposing that view onto smaller, self-contained child components
// (Task 38 did ServerConfig.vue's Snapshots tab, Tasks 39-40 did this same
// view's Logs and Import modals; see .superpowers/sdd/task-41-brief.md).
// This is PipeSources.vue's last genuinely self-contained extraction --
// the remaining `showDialog` add/edit-pipe form is meaningfully more
// coupled and stays deferred.
//
// Trigger ("Service file"/"MPD block") lives in the parent's per-pipe
// card, outside this component's own markup, and needs an argument
// (which pipe) -- same shape as Task 39's viewLogs(pipe) trigger. Kept the
// same defineExpose'd open(pipe) + template-ref pattern for consistency
// with LogsModal.vue.
//
// Self-sufficient otherwise: talks to `store` (the pipe-sources Pinia
// store) and `uiStore` (the UI/toast store) directly, no prop-drilling
// needed for either.
import { ref } from 'vue';
import { Dialog, DialogPanel, TransitionChild, TransitionRoot } from '@headlessui/vue';
import { usePipeSourcesStore, type PipeSource } from '../../stores/pipeSources';
import { useUIStore } from '../../stores/ui';

const store = usePipeSourcesStore();
const uiStore = useUIStore();

const showConfigEditor = ref(false);
const configEditorPipe = ref<PipeSource | null>(null);
const configContent = ref('');
const configFilePath = ref('');
const loadingConfig = ref(false);
const savingConfig = ref(false);

async function open(pipe: PipeSource) {
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

defineExpose({ open });
</script>

<template>
  <TransitionRoot as="template" :show="showConfigEditor">
    <Dialog as="div" class="relative z-50" @close="showConfigEditor = false">
      <TransitionChild
        as="template"
        enter="ease-out duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-200"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/80 backdrop-blur-sm" />
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
          <DialogPanel class="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl" style="max-height: 85vh;">
        <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800 flex-shrink-0">
          <div>
            <h3 class="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <span class="material-symbols-outlined text-[1rem] text-amber-400">description</span>
              {{ configEditorPipe?.type === 'mpd' ? 'MPD audio_output block' : 'Systemd Service File' }}
              — {{ configEditorPipe?.name }}
            </h3>
            <p class="text-xs text-zinc-400 mt-0.5 font-mono">{{ configFilePath }}</p>
          </div>
          <button @click="showConfigEditor = false" class="text-zinc-500 hover:text-zinc-300 transition min-w-[40px] min-h-[40px] flex items-center justify-center" aria-label="Close config editor">
            <span class="material-symbols-outlined text-[1.2rem]">close</span>
          </button>
        </div>

        <div class="flex-1 overflow-hidden flex flex-col p-4 gap-3 min-h-0">
          <div v-if="loadingConfig" class="text-zinc-400 text-sm text-center py-8">Loading…</div>
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
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
