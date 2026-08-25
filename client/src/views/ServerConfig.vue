<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { basicEditor } from 'prism-code-editor/setups';
import 'prism-code-editor/prism/languages/ini';
import 'prism-code-editor/layout.css';
import 'prism-code-editor/themes/github-dark.css';
import 'prism-code-editor/themes/github-light.css';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SnapshotsPanel from '../components/server-config/SnapshotsPanel.vue';
import StandardTab from '../components/server-config/StandardTab.vue';



const route = useRoute();
const configStore = useConfigStore();
const systemStore = useSystemStore();
const uiStore = useUIStore();



const snapshotStore = useSnapshotStore();

const validTabs = ['standard', 'expert', 'snapshots'] as const;
const activeTab = ref<typeof validTabs[number]>(
  (validTabs.includes(route.query.tab as any) ? route.query.tab : 'standard') as typeof validTabs[number]
);

watch(() => route.query.tab, (tab) => {
  if (validTabs.includes(tab as any)) {
    activeTab.value = tab as typeof validTabs[number];
  }
});
const localRawConfig = ref('');
const editorRef = ref<HTMLElement | null>(null);
let editorInstance: any = null;
const localParsedConfig = ref<Record<string, any>>({});
const configMetadata = ref<Record<string, any>>({});
const configSections = ref<Record<string, any>>({});


const sourceTemplates = ref<any[]>([]);

// Tracks which properties are "enabled" (will be saved)
const enabledProperties = ref<Record<string, Record<string, boolean>>>({});

// Dialog State
const showConfirmRestart = ref(false);
const showConfirmReset = ref(false);

// Task 44: duplicated from StandardTab.vue's copy (needed there for the
// section-switcher tab order). initializeEnabledState() below stays in
// this parent (it's tied to fetchBoth()'s lifecycle, used by more than
// just the Standard tab) but needs the fixed section list to seed
// `enabledProperties` for every section, not just whichever section
// happens to be active. A small, pure constant -- duplicating it here
// matches Task 43's precedent for extractSourceName rather than building
// shared-utils machinery for one 8-item array.
const sectionOrder = ['server', 'ssl', 'http', 'tcp-control', 'tcp-streaming', 'stream', 'streaming_client', 'logging'];

// Initialize enabledProperties tracking based on what's actually in the parsed config
const initializeEnabledState = () => {
  const enabled: Record<string, Record<string, boolean>> = {};
  
  for (const section of sectionOrder) {
    enabled[section] = {};
    const metaKeys = Object.keys(configMetadata.value[section] || {});
    const configKeys = Object.keys(localParsedConfig.value[section] || {});
    
    for (const key of metaKeys) {
      // A property is enabled if it exists in the parsed config
      enabled[section][key] = configKeys.includes(key);
    }
    // Any config key not in metadata is also enabled (custom properties)
    for (const key of configKeys) {
      if (!metaKeys.includes(key)) {
        enabled[section][key] = true;
      }
    }
  }
  
  enabledProperties.value = enabled;
};

const fetchBoth = async () => {
  await configStore.fetchServerConfig();
  await configStore.fetchServerConfigParsed();
  
  try {
    const [metaRes, sectionsRes, templatesRes] = await Promise.all([
      fetchApi('/config/metadata'),
      fetchApi('/config/sections'),
      fetchApi('/config/source-templates'),
    ]);
    configMetadata.value = metaRes;
    configSections.value = sectionsRes;
    sourceTemplates.value = templatesRes;
  } catch (error) {
    console.error('Failed to fetch config metadata:', error);
  }

  localRawConfig.value = configStore.serverConfig;
  localParsedConfig.value = JSON.parse(JSON.stringify(configStore.serverConfigParsed));
  
  initializeEnabledState();
};

onMounted(async () => {
    await fetchBoth();
    await snapshotStore.fetchSnapshots();
});

watch(activeTab, async (newTab) => {
    if (newTab === 'expert') {
        await nextTick();
        if (editorRef.value) {
            editorInstance = basicEditor(
                editorRef.value,
                {
                    language: 'ini',
                    theme: uiStore.isDark ? 'github-dark' : 'github-light',
                    value: localRawConfig.value
                },
                () => {
                    if (editorInstance && typeof editorInstance.on === 'function') {
                        editorInstance.on('update', (value: string) => {
                            localRawConfig.value = value;
                        });
                    }
                }
            );
        }
    } else {
        editorInstance = null;
    }
});

watch(() => uiStore.isDark, (isDark) => {
    if (editorInstance) {
        editorInstance.setOptions({ theme: isDark ? 'github-dark' : 'github-light' });
    }
});

watch(localRawConfig, (newVal) => {
    if (editorInstance && editorInstance.value !== newVal) {
        editorInstance.setOptions({ value: newVal });
    }
});

const saveParsed = async () => {
    try {
        await configStore.updateServerConfigParsed(localParsedConfig.value);
        await fetchBoth();
        showConfirmRestart.value = true;
    } catch (e: any) {
        uiStore.showToast('Failed to save configuration: ' + e.message, 'error');
    }
};

const saveRaw = async () => {
    try {
        await configStore.updateServerConfig(localRawConfig.value);
        await fetchBoth();
        showConfirmRestart.value = true;
    } catch (e: any) {
        uiStore.showToast('Failed to save configuration: ' + e.message, 'error');
    }
};

const handleRestartConfirm = async () => {
  try {
    await systemStore.controlService('restart', 'snapserver');
    uiStore.showToast('Server restarted successfully', 'success');
  } catch (e: any) {
    uiStore.showToast('Failed to restart: ' + e.message, 'error');
  }
};

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

// Task 38: SnapshotsPanel.vue owns the restore/delete/create flow itself
// (it talks to snapshotStore directly) but a successful restore also
// needs THIS view to re-fetch the Standard/Expert tabs' config state and
// offer a Snapserver restart — both are ServerConfig.vue-owned concerns,
// so the child emits 'restored' and this handler does that part.
const handleSnapshotRestored = async () => {
    await fetchBoth();
    showConfirmRestart.value = true;
};

const handleResetToDefault = async () => {
    try {
        const response = await fetch('/api/config/reset', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (response.ok) {
          await fetchBoth();
          uiStore.showToast('Configuration reset to defaults', 'success');
          showConfirmRestart.value = true;
        } else {
          throw new Error('Failed to reset');
        }
    } catch (e: any) {
        uiStore.showToast('Failed to reset configuration: ' + e.message, 'error');
    }
};

const handleSave = () => {
    if (activeTab.value === 'standard') {
        saveParsed();
    } else if (activeTab.value === 'expert') {
        saveRaw();
    }
};
</script>

<template>
  <Layout>
      <!-- Main Tabs Navigation & Actions -->
      <div class="sticky top-[57px] z-30 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 p-2 bg-brand-bg/60 backdrop-blur-xl border border-white/5 rounded-3xl shadow-2xl">
          <div class="flex overflow-x-auto flex-nowrap space-x-2 bg-black/40 p-1.5 rounded-2xl w-fit max-w-full border border-white/10">
              <button
                @click="activeTab = 'standard'"
                :class="[
                    'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                    activeTab === 'standard'
                    ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]">tune</span>
                  <div class="flex flex-col items-start">
                    <span>Standard</span>
                    <span class="text-[9px] font-normal normal-case tracking-normal opacity-60">Visual editor</span>
                  </div>
              </button>
              <button
                @click="activeTab = 'expert'"
                :class="[
                    'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                    activeTab === 'expert'
                    ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]">code</span>
                  <div class="flex flex-col items-start">
                    <span>Expert</span>
                    <span class="text-[9px] font-normal normal-case tracking-normal opacity-60">Raw INI file</span>
                  </div>
              </button>
              <button
                @click="activeTab = 'snapshots'"
                :class="[
                    'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                    activeTab === 'snapshots'
                    ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]">history</span>
                  <div class="flex flex-col items-start">
                    <span>Snapshots</span>
                    <span class="text-[9px] font-normal normal-case tracking-normal opacity-60">Version history</span>
                  </div>
              </button>
          </div>

          <!-- Quick Actions (Save) -->
          <div v-if="activeTab === 'standard' || activeTab === 'expert'" class="flex items-center px-2">
              <button 
                  @click="handleSave" 
                  :disabled="configStore.loading"
                  class="w-full md:w-auto flex items-center justify-center space-x-3 px-8 py-3 rounded-2xl shadow-[0_0_20px_rgba(166,13,242,0.4)] text-[11px] font-black text-white bg-brand-primary hover:bg-[#b526ff] hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 transition-all duration-300 border border-white/10 uppercase tracking-[0.2em]"
              >
                  <span v-if="configStore.loading" class="material-symbols-outlined text-[18px] animate-spin">sync</span>
                  <span v-else class="material-symbols-outlined text-[18px]">save</span>
                  <span>Save Configuration</span>
              </button>
          </div>
      </div>

      <!-- ==================== STANDARD TAB ==================== -->
      <!-- Task 44: extracted to components/server-config/StandardTab.vue -->
      <div v-if="activeTab === 'standard'" class="animate-in fade-in slide-in-from-left-4 duration-500">
          <StandardTab
            :localParsedConfig="localParsedConfig"
            :enabledProperties="enabledProperties"
            :configMetadata="configMetadata"
            :configSections="configSections"
            :sourceTemplates="sourceTemplates"
            @reset-requested="showConfirmReset = true"
          />
      </div>

      <!-- ==================== EXPERT TAB ==================== -->
      <div v-else-if="activeTab === 'expert'" class="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
          <!-- Page Header -->
          <div class="flex items-center justify-between">
              <div>
                  <h2 class="text-xl font-black text-white uppercase tracking-wider drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">Raw Editor</h2>
                  <p class="text-[11px] font-bold text-text-muted uppercase tracking-widest mt-1">
                      Directly modify the <code class="bg-brand-primary/20 px-1.5 py-0.5 rounded text-brand-primary text-[10px] font-mono border border-brand-primary/10">snapserver.conf</code> for advanced control.
                  </p>
              </div>
              <div class="flex items-center space-x-3">
                  <button @click="fetchBoth" class="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-white/5 bg-black/20 hover:bg-white/5 text-gray-400 hover:text-white transition-all text-xs font-black uppercase tracking-widest">
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
                  <button @click="fetchBoth" class="w-full sm:w-auto py-3.5 px-6 rounded-xl text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-all text-xs font-black uppercase tracking-widest border border-white/5 flex items-center justify-center">
                      Discard Changes
                  </button>
              </div>
          </div>

      </div>

      <!-- ==================== SNAPSHOTS TAB ==================== -->
      <!-- Task 38: extracted to components/server-config/SnapshotsPanel.vue -->
      <SnapshotsPanel v-else-if="activeTab === 'snapshots'" @restored="handleSnapshotRestored" />

      <!-- ==================== DIALOGS ==================== -->
      <ConfirmDialog
        v-model="showConfirmRestart"
        title="Restart Snapserver?"
        message="Configuration saved! Restart now to apply changes?"
        confirmText="Restart Now"
        @confirm="handleRestartConfirm"
      />

      <ConfirmDialog
        v-model="showConfirmReset"
        title="Reset to Defaults?"
        message="This will wipe your current configuration base and restore it to the default Snapserver values. Use with caution!"
        type="danger"
        confirmText="Reset Configuration"
        @confirm="handleResetToDefault"
      />
  </Layout>
</template>

