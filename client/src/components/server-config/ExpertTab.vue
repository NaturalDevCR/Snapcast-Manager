<script setup lang="ts">
// Task 45: extracted from ServerConfig.vue's "Expert" tab -- the ninth and
// final slice of decomposing that view (see
// .superpowers/sdd/task-45-brief.md). Completes item 4.6 for both
// monolithic views' decomposition entirely.
//
// DIFFERENT sharing pattern than Task 43/44's AddEditSourceDialog.vue /
// StandardTab.vue: those solved "child mutates a nested path on the
// parent's plain OBJECT ref" (works because JS objects are passed by
// reference). The raw INI text here is a plain STRING
// (ServerConfig.vue's `localRawConfig = ref('')`) -- a primitive, copied
// by value, not shared by reference -- so passing `.value` as a prop and
// reassigning it in the child would NOT propagate back to the parent.
// `defineModel` is the correct Vue 3.4+ tool for "parent and child both
// need to read AND write the same primitive value": it gives real two-way
// binding without a plain-object-mutation escape hatch.
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { basicEditor } from 'prism-code-editor/setups';
import 'prism-code-editor/prism/languages/ini';
import 'prism-code-editor/layout.css';
import 'prism-code-editor/themes/github-dark.css';
import 'prism-code-editor/themes/github-light.css';
import { useUIStore } from '../../stores/ui';

const rawConfig = defineModel<string>('rawConfig', { required: true });

// Matches Task 44's `reset-requested` naming: the "Revert"/"Discard
// Changes" buttons both need the parent's `fetchBoth()` (the SAME
// function it already calls on mount and after saves) -- re-fetching
// isn't this component's concern, so it asks the parent to do it rather
// than duplicating fetchBoth() here.
const emit = defineEmits<{ 'revert-requested': [] }>();

const uiStore = useUIStore();

const editorRef = ref<HTMLElement | null>(null);
let editorInstance: any = null;

// This component is only ever mounted while `activeTab === 'expert'`
// (gated by the parent's `v-else-if`, same as StandardTab.vue /
// SnapshotsPanel.vue), so the original parent-side
// `watch(activeTab, ...)` that created the editor instance on switching
// INTO this tab and tore it down on switching AWAY simplifies to a plain
// onMounted/onUnmounted pair here: onMounted fires once per mount (i.e.
// once per navigation into the tab, same as before), and onUnmounted
// fires on navigating away (same teardown timing as the old `else`
// branch nulling out `editorInstance`).
onMounted(async () => {
    if (editorRef.value) {
        editorInstance = basicEditor(
            editorRef.value,
            {
                language: 'ini',
                theme: uiStore.isDark ? 'github-dark' : 'github-light',
                value: rawConfig.value
            },
            () => {
                if (editorInstance && typeof editorInstance.on === 'function') {
                    editorInstance.on('update', (value: string) => {
                        rawConfig.value = value;
                    });
                }
            }
        );
    }
});

onUnmounted(() => {
    editorInstance = null;
});

watch(() => uiStore.isDark, (isDark) => {
    if (editorInstance) {
        editorInstance.setOptions({ theme: isDark ? 'github-dark' : 'github-light' });
    }
});

watch(rawConfig, (newVal) => {
    if (editorInstance && editorInstance.value !== newVal) {
        editorInstance.setOptions({ value: newVal });
    }
});

const isExporting = ref(false);

const handleExportBackup = async () => {
    isExporting.value = true;
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/system/export', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        const contentDisposition = response.headers.get('content-disposition');
        let filename = `snapcast-backup-${Date.now()}.tar.gz`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            if (filenameMatch && filenameMatch.length === 2) {
                filename = filenameMatch[1] || filename;
            }
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        uiStore.showToast('Backup downloaded successfully', 'success');
    } catch (e: any) {
        uiStore.showToast(e.message || 'Failed to download backup', 'error');
    } finally {
        isExporting.value = false;
    }
};
</script>

<template>
  <div class="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
      <!-- Page Header -->
      <div class="flex items-center justify-between">
          <div>
              <h2 class="text-xl font-black text-white uppercase tracking-wider drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">Raw Editor</h2>
              <p class="text-[11px] font-bold text-text-muted uppercase tracking-widest mt-1">
                  Directly modify the <code class="bg-brand-primary/20 px-1.5 py-0.5 rounded text-brand-primary text-[10px] font-mono border border-brand-primary/10">snapserver.conf</code> for advanced control.
              </p>
          </div>
          <div class="flex items-center space-x-3">
              <button @click="emit('revert-requested')" class="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-white/5 bg-black/20 hover:bg-white/5 text-gray-400 hover:text-white transition-all text-xs font-black uppercase tracking-widest">
                  <span class="material-symbols-outlined text-[16px]">history</span>
                  <span>Revert</span>
              </button>
              <button @click="handleExportBackup" class="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-white/5 bg-black/20 hover:bg-white/5 text-gray-400 hover:text-white transition-all text-xs font-black uppercase tracking-widest">
                  <span class="material-symbols-outlined text-[16px]">download</span>
                  <span>Backup</span>
              </button>
          </div>
      </div>

      <!-- Editor Wrapper -->
      <div class="rounded-2xl border border-white/5 bg-[#140b1b]/80 backdrop-blur-md overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          <!-- Frame Header -->
          <div class="bg-black/30 px-6 py-2.5 flex items-center justify-between text-[10px] font-mono text-gray-400 border-b border-white/5">
              <div class="flex items-center space-x-2">
                  <span class="material-symbols-outlined text-[14px]">description</span>
                  <span>/etc/snapserver.conf</span>
              </div>
              <div class="flex items-center space-x-4">
                  <span>UTF-8</span>
                  <span>INI</span>
              </div>
          </div>

          <!-- Code Editor Container -->
          <div ref="editorRef" class="text-xs font-mono pce-custom"></div>
      </div>

      <!-- Footer Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="flex items-start sm:items-center space-x-2 text-amber-500 text-xs font-bold uppercase tracking-widest bg-amber-500/5 px-4 py-3 rounded-xl border border-amber-500/10 w-full sm:w-auto">
              <span class="material-symbols-outlined text-[16px] drop-shadow-[0_0_5px_rgba(245,158,11,0.5)] mt-0.5 sm:mt-0">warning</span>
              <span class="leading-relaxed">Warning: Restart required after applying changes to configuration.</span>
          </div>
          <div class="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <button @click="emit('revert-requested')" class="w-full sm:w-auto py-3.5 px-6 rounded-xl text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all text-xs font-black uppercase tracking-widest border border-white/5 flex items-center justify-center">
                  Discard Changes
              </button>
          </div>
      </div>
  </div>
</template>
