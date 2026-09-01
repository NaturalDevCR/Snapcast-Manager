<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import SnapshotsPanel from '../components/server-config/SnapshotsPanel.vue';
import StandardTab from '../components/server-config/StandardTab.vue';
import ExpertTab from '../components/server-config/ExpertTab.vue';



const route = useRoute();
const configStore = useConfigStore();
const systemStore = useSystemStore();
const uiStore = useUIStore();
const { t } = useI18n({ useScope: 'global' });



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
const localParsedConfig = ref<Record<string, any>>({});
const configMetadata = ref<Record<string, any>>({});
const configSections = ref<Record<string, any>>({});


const sourceTemplates = ref<any[]>([]);

// Tracks which properties are "enabled" (will be saved)
const enabledProperties = ref<Record<string, Record<string, boolean>>>({});

// Dialog State
const showConfirmRestart = ref(false);
const showConfirmReset = ref(false);

// Task 44 (fix pass): single-owner declaration. initializeEnabledState()
// below needs the fixed section list to seed `enabledProperties` for every
// section (it's tied to fetchBoth()'s lifecycle, used by more than just the
// Standard tab), and StandardTab.vue needs the same list for its
// section-switcher tab order. Declared once here and passed down as a
// static prop (`:sectionOrder="sectionOrder"`), exactly like `configMetadata`
// /`configSections`/`sourceTemplates` below -- no reason to duplicate a
// plain readonly array when the parent already owns it first.
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

const saveParsed = async () => {
    try {
        await configStore.updateServerConfigParsed(localParsedConfig.value);
        await fetchBoth();
        showConfirmRestart.value = true;
    } catch (e: any) {
        uiStore.showToast(t('serverConfig.saveFailedToast', { message: e.message }), 'error');
    }
};

const saveRaw = async () => {
    try {
        await configStore.updateServerConfig(localRawConfig.value);
        await fetchBoth();
        showConfirmRestart.value = true;
    } catch (e: any) {
        uiStore.showToast(t('serverConfig.saveFailedToast', { message: e.message }), 'error');
    }
};

const handleRestartConfirm = async () => {
  try {
    await systemStore.controlService('restart', 'snapserver');
    uiStore.showToast(t('serverConfig.restartSuccessToast'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('serverConfig.restartFailedToast', { message: e.message }), 'error');
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
          uiStore.showToast(t('serverConfig.resetSuccessToast'), 'success');
          showConfirmRestart.value = true;
        } else {
          throw new Error(t('serverConfig.resetError'));
        }
    } catch (e: any) {
        uiStore.showToast(t('serverConfig.resetFailedToast', { message: e.message }), 'error');
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
      <div class="sticky top-[57px] z-30 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 p-2 bg-brand-bg/60 backdrop-blur-xl border border-black/5 dark:border-white/5 rounded-3xl shadow-2xl">
          <div class="flex overflow-x-auto flex-nowrap space-x-2 bg-black/40 p-1.5 rounded-2xl w-fit max-w-full border border-black/10 dark:border-white/10">
              <button
                @click="activeTab = 'standard'"
                :class="[
                    'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                    activeTab === 'standard'
                    ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]">tune</span>
                  <div class="flex flex-col items-start">
                    <span>{{ t('serverConfig.tabStandard') }}</span>
                    <span class="text-[9px] font-normal normal-case tracking-normal opacity-60">{{ t('serverConfig.tabStandardSub') }}</span>
                  </div>
              </button>
              <button
                @click="activeTab = 'expert'"
                :class="[
                    'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                    activeTab === 'expert'
                    ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]">code</span>
                  <div class="flex flex-col items-start">
                    <span>{{ t('serverConfig.tabExpert') }}</span>
                    <span class="text-[9px] font-normal normal-case tracking-normal opacity-60">{{ t('serverConfig.tabExpertSub') }}</span>
                  </div>
              </button>
              <button
                @click="activeTab = 'snapshots'"
                :class="[
                    'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                    activeTab === 'snapshots'
                    ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'text-gray-400 hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]">history</span>
                  <div class="flex flex-col items-start">
                    <span>{{ t('serverConfig.tabSnapshots') }}</span>
                    <span class="text-[9px] font-normal normal-case tracking-normal opacity-60">{{ t('serverConfig.tabSnapshotsSub') }}</span>
                  </div>
              </button>
          </div>

          <!-- Quick Actions (Save) -->
          <div v-if="activeTab === 'standard' || activeTab === 'expert'" class="flex items-center px-2">
              <button 
                  @click="handleSave" 
                  :disabled="configStore.loading"
                  class="w-full md:w-auto flex items-center justify-center space-x-3 px-8 py-3 rounded-2xl shadow-[0_0_20px_rgba(166,13,242,0.4)] text-[11px] font-black text-white bg-brand-primary hover:bg-[#b526ff] hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 transition-all duration-300 border border-black/10 dark:border-white/10 uppercase tracking-[0.2em]"
              >
                  <span v-if="configStore.loading" class="material-symbols-outlined text-[18px] animate-spin">sync</span>
                  <span v-else class="material-symbols-outlined text-[18px]">save</span>
                  <span>{{ t('serverConfig.saveConfiguration') }}</span>
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
            :sectionOrder="sectionOrder"
            @reset-requested="showConfirmReset = true"
          />
      </div>

      <!-- ==================== EXPERT TAB ==================== -->
      <!-- Task 45: extracted to components/server-config/ExpertTab.vue -->
      <ExpertTab
        v-else-if="activeTab === 'expert'"
        v-model:rawConfig="localRawConfig"
        @revert-requested="fetchBoth"
      />

      <!-- ==================== SNAPSHOTS TAB ==================== -->
      <!-- Task 38: extracted to components/server-config/SnapshotsPanel.vue -->
      <SnapshotsPanel v-else-if="activeTab === 'snapshots'" @restored="handleSnapshotRestored" />

      <!-- ==================== DIALOGS ==================== -->
      <ConfirmDialog
        v-model="showConfirmRestart"
        :title="t('serverConfig.restartDialogTitle')"
        :message="t('serverConfig.restartDialogMessage')"
        :confirmText="t('serverConfig.restartDialogConfirm')"
        @confirm="handleRestartConfirm"
      />

      <ConfirmDialog
        v-model="showConfirmReset"
        :title="t('serverConfig.resetDialogTitle')"
        :message="t('serverConfig.resetDialogMessage')"
        type="danger"
        :confirmText="t('serverConfig.resetDialogConfirm')"
        @confirm="handleResetToDefault"
      />
  </Layout>
</template>

