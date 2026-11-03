<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import Button from '../components/ui/Button.vue';
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

const configTabs = computed(() => [
  { key: 'standard' as const, icon: 'tune', label: t('serverConfig.tabStandard'), hint: t('serverConfig.tabStandardSub') },
  { key: 'expert' as const, icon: 'code', label: t('serverConfig.tabExpert'), hint: t('serverConfig.tabExpertSub') },
  { key: 'snapshots' as const, icon: 'history', label: t('serverConfig.tabSnapshots'), hint: t('serverConfig.tabSnapshotsSub') },
]);
</script>

<template>
  <Layout>
      <PageHeader :title="t('serverConfig.title')" :description="t('serverConfig.subtitle')" />

      <!-- Tabs + Save: sticky so Save stays reachable while scrolling long forms -->
      <div class="sticky top-14 lg:top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-10 mb-6 px-4 sm:px-6 lg:px-10 py-3 bg-brand-bg/85 backdrop-blur-xl border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex overflow-x-auto no-scrollbar gap-1 rounded-xl border border-line bg-inset p-1 w-fit max-w-full" role="tablist">
              <button
                v-for="tab in configTabs"
                :key="tab.key"
                type="button"
                role="tab"
                :aria-selected="activeTab === tab.key"
                :title="tab.hint"
                @click="activeTab = tab.key"
                :class="[
                    'flex items-center gap-2 px-3.5 py-1.5 rounded-lg whitespace-nowrap text-sm font-semibold transition-colors',
                    activeTab === tab.key ? 'bg-brand-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
                ]"
              >
                  <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{ tab.icon }}</span>
                  {{ tab.label }}
              </button>
          </div>

          <Button v-if="activeTab === 'standard' || activeTab === 'expert'" :loading="configStore.loading" @click="handleSave">
              <span v-if="!configStore.loading" class="material-symbols-outlined text-[18px]" aria-hidden="true">save</span>
              {{ t('serverConfig.saveConfiguration') }}
          </Button>
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

