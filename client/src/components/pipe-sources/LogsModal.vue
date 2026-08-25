<script setup lang="ts">
// Task 39: extracted from PipeSources.vue -- the second slice of
// decomposing that view onto smaller, self-contained child components
// (Task 38 did the first slice, on ServerConfig.vue's Snapshots tab; see
// .superpowers/sdd/task-39-brief.md).
//
// Unlike Task 38's SnapshotsPanel (whose trigger button lived inside the
// panel itself), this modal's trigger ("View Logs") lives in the parent's
// pipe-source list, outside this component's own markup. The parent needs
// a way to say "show yourself for THIS pipe" -- a v-model boolean alone
// isn't enough since we also need to know *which* pipe, and a plain
// prop+emit pair would force the parent to keep a "which pipe is open"
// ref of its own. A defineExpose'd open(pipe) method lets the parent hand
// off both "which pipe" and "when" in one imperative call, exactly
// mirroring the current viewLogs(pipe) call site, so PipeSources.vue's
// template needs only a template ref and an unchanged @click handler
// signature.
//
// Self-sufficient otherwise: talks to `store` (the pipe-sources Pinia
// store) directly to fetch logs, no prop-drilling needed for that part.
import { ref } from 'vue';
import { Dialog, DialogPanel, TransitionChild, TransitionRoot } from '@headlessui/vue';
import { usePipeSourcesStore, type PipeSource } from '../../stores/pipeSources';

const store = usePipeSourcesStore();

const showLogs = ref(false);
const logsContent = ref('');
const logsTitle = ref('');
const loadingLogs = ref(false);

async function open(pipe: PipeSource) {
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

defineExpose({ open });
</script>

<template>
  <TransitionRoot as="template" :show="showLogs">
    <Dialog as="div" class="relative z-50" @close="showLogs = false">
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
          <DialogPanel class="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl h-[70vh] flex flex-col shadow-2xl">
            <div class="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 class="text-sm font-semibold text-zinc-200">
                <span class="material-symbols-outlined text-[1rem] mr-1 align-middle">terminal</span>
                Logs — {{ logsTitle }}
              </h3>
              <button @click="showLogs = false" class="text-zinc-500 hover:text-zinc-300 transition min-w-[40px] min-h-[40px] flex items-center justify-center" aria-label="Close logs">
                <span class="material-symbols-outlined text-[1.2rem]">close</span>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
              <div v-if="loadingLogs" class="text-zinc-400 text-sm text-center py-8">Loading logs…</div>
              <pre v-else class="text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-5">{{ logsContent || 'No log output.' }}</pre>
            </div>
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
