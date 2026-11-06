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
import { useUIStore } from '../../stores/ui';
import { createCodeEditor, type CodeEditor } from '../../utils/codeEditor';

const rawConfig = defineModel<string>('rawConfig', { required: true });

// Matches Task 44's `reset-requested` naming: the "Revert"/"Discard
// Changes" buttons both need the parent's `fetchBoth()` (the SAME
// function it already calls on mount and after saves) -- re-fetching
// isn't this component's concern, so it asks the parent to do it rather
// than duplicating fetchBoth() here.
const emit = defineEmits<{ 'revert-requested': [] }>();

const uiStore = useUIStore();

const editorRef = ref<HTMLElement | null>(null);
let editorInstance: CodeEditor | null = null;

// This component is only ever mounted while `activeTab === 'expert'`
// (gated by the parent's `v-else-if`, same as StandardTab.vue /
// SnapshotsPanel.vue), so the original parent-side
// `watch(activeTab, ...)` that created the editor instance on switching
// INTO this tab and tore it down on switching AWAY simplifies to a plain
// onMounted/onUnmounted pair here: onMounted fires once per mount (i.e.
// once per navigation into the tab, same as before), and onUnmounted
// fires on navigating away (same teardown timing as the old `else`
// branch nulling out `editorInstance`).
onMounted(() => {
    if (!editorRef.value) return;
    editorInstance = createCodeEditor(editorRef.value, {
        language: 'ini',
        value: rawConfig.value
    });
    editorInstance.on('update', (value: string) => {
        rawConfig.value = value;
    });
});

onUnmounted(() => {
    editorInstance?.remove();
    editorInstance = null;
});

// The comparison makes this a no-op for the editor's own writes, so only
// external changes (Revert, a fresh GET) reach setOptions().
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
              <h2 class="text-xl font-semibold text-text-main dark:">Raw Editor</h2>
              <p class="text-xs font-bold text-text-muted mt-1">
                  Directly modify the <code class="bg-brand-primary/20 px-1.5 py-0.5 rounded text-brand-primary text-[10px] font-mono border border-brand-primary/10">snapserver.conf</code> for advanced control.
              </p>
          </div>
          <div class="flex items-center space-x-3">
              <button @click="emit('revert-requested')" class="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-line bg-inset hover:bg-line text-text-muted hover:text-text-main transition-all text-xs font-semibold">
                  <span class="material-symbols-outlined text-[16px]">history</span>
                  <span>Revert</span>
              </button>
              <button @click="handleExportBackup" class="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-line bg-inset hover:bg-line text-text-muted hover:text-text-main transition-all text-xs font-semibold">
                  <span class="material-symbols-outlined text-[16px]">download</span>
                  <span>Backup</span>
              </button>
          </div>
      </div>

      <!-- Editor Wrapper -->
      <div class="rounded-2xl border border-line bg-brand-surface overflow-hidden shadow-sm">
          <!-- Frame Header -->
          <div class="bg-inset px-6 py-2.5 flex items-center justify-between text-[10px] font-mono text-text-muted border-b border-line">
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
          <div ref="editorRef" class="code-editor-host h-[65vh] min-h-80 text-xs"></div>
      </div>

      <!-- Footer Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="flex items-start sm:items-center space-x-2 text-warning text-xs font-bold bg-warning/5 px-4 py-3 rounded-xl border border-warning/10 w-full sm:w-auto">
              <span class="material-symbols-outlined text-[16px] mt-0.5 sm:mt-0">warning</span>
              <span class="leading-relaxed">Warning: Restart required after applying changes to configuration.</span>
          </div>
          <div class="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <button @click="emit('revert-requested')" class="w-full sm:w-auto py-3.5 px-6 rounded-xl text-text-muted hover:text-text-main bg-inset hover:bg-line transition-all text-xs font-semibold border border-line flex items-center justify-center">
                  Discard Changes
              </button>
          </div>
      </div>
  </div>
</template>
