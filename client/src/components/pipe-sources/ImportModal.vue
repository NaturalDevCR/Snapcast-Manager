<script setup lang="ts">
// Task 40: extracted from PipeSources.vue -- the third slice of
// decomposing that view onto smaller, self-contained child components
// (Task 38 did ServerConfig.vue's Snapshots tab, Task 39 did this same
// view's Logs modal; see .superpowers/sdd/task-40-brief.md).
//
// Trigger ("Import Existing") lives in the parent's header toolbar,
// outside this component's own markup -- same shape as Task 39's
// viewLogs(pipe) trigger. Unlike that modal though, this one's open
// doesn't need any argument from the parent (no "which pipe"), so a
// v-model boolean would have been sufficient here. Kept the same
// defineExpose'd open() + template-ref pattern anyway for consistency
// with LogsModal.vue -- same directory, same "child owns its own
// visibility and imperatively kicks off its own fetch on open" shape,
// and it keeps the parent's call site a one-line `?.open()` instead of
// introducing a second wiring convention in this directory for no
// concrete benefit.
//
// Self-sufficient otherwise: talks to `store` (the pipe-sources Pinia
// store) and `uiStore` (the UI/toast store) directly, no prop-drilling
// needed for either.
import { ref, computed } from 'vue';
import { Dialog, DialogPanel, TransitionChild, TransitionRoot } from '@headlessui/vue';
import {
  usePipeSourcesStore,
  type DiscoveredPipe,
  type AdoptInput,
  type PipeSourceType,
} from '../../stores/pipeSources';
import { useUIStore } from '../../stores/ui';
import EmptyState from '../ui/EmptyState.vue';

const store = usePipeSourcesStore();
const uiStore = useUIStore();

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

async function open() {
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

defineExpose({ open });
</script>

<template>
  <TransitionRoot as="template" :show="showImportModal">
    <Dialog as="div" class="relative z-50" @close="showImportModal = false">
      <TransitionChild
        as="template"
        enter="ease-out duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-200"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/75 backdrop-blur-sm" />
      </TransitionChild>

      <div class="fixed inset-0 z-10 flex items-start justify-center p-4 pt-16 overflow-y-auto">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0 scale-95"
          enter-to="opacity-100 scale-100"
          leave="ease-in duration-200"
          leave-from="opacity-100 scale-100"
          leave-to="opacity-0 scale-95"
        >
          <DialogPanel class="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl shadow-2xl mb-8">
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h3 class="text-base font-bold text-zinc-200">Import Existing Pipe Sources</h3>
            <p class="text-xs text-zinc-400 mt-0.5">Discovers unmanaged <code class="bg-zinc-800 px-1 rounded">pipe://</code> sources in snapserver.conf and adopts them.</p>
          </div>
          <button @click="showImportModal = false" class="text-zinc-500 hover:text-zinc-300 transition min-w-[40px] min-h-[40px] flex items-center justify-center" aria-label="Close import dialog">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="p-6 space-y-4">
          <div v-if="discovering" class="text-center py-8 text-zinc-400 text-sm">
            <span class="material-symbols-outlined animate-spin inline-block mr-2 text-[1.2rem]">refresh</span>
            Scanning snapserver config…
          </div>
          <div v-else-if="discovered.length === 0" class="text-sm">
            <EmptyState icon="check_circle" title="No unmanaged pipe:// sources found" />
          </div>
          <div v-else-if="pendingDiscovered.length === 0" class="text-center py-8 text-zinc-400 text-sm">
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
                <span class="text-xs font-mono text-zinc-400">{{ d.fifoPath }}</span>
              </div>
              <div v-if="d.existingService" class="text-right">
                <span class="text-xs text-zinc-400">{{ d.existingService.name }}</span>
                <span :class="['ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold', d.existingService.isActive ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-300']">
                  {{ d.existingService.isActive ? 'active' : 'inactive' }}
                </span>
              </div>
            </div>

            <!-- Form -->
            <div v-if="!f.adopted" class="px-4 py-4 space-y-3">
              <!-- Type override -->
              <div class="flex gap-2">
                <button @click="f.type = 'radio'"
                  :class="['flex-1 py-1.5 rounded border text-xs font-medium transition', f.type === 'radio' ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600']">
                  Radio
                </button>
                <button @click="f.type = 'mpd'"
                  :class="['flex-1 py-1.5 rounded border text-xs font-medium transition', f.type === 'mpd' ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600']">
                  MPD
                </button>
              </div>

              <!-- Radio fields -->
              <template v-if="f.type === 'radio'">
                <div>
                  <label class="block text-xs text-zinc-400 mb-1">Stream URL <span class="text-red-400">*</span></label>
                  <input v-model="f.url" type="url" placeholder="https://…/radio.mp3"
                    class="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 font-mono focus:border-purple-500 focus:outline-none" />
                  <p v-if="d.existingService?.url" class="text-[10px] text-zinc-400 mt-1">Auto-detected from existing service.</p>
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
          </DialogPanel>
        </TransitionChild>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
