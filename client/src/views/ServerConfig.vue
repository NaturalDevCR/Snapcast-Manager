<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import { 
    AdjustmentsHorizontalIcon, 
    CodeBracketIcon, 
    ClockIcon, 
    PlusIcon, 
    TrashIcon, 
    ArrowPathIcon,
    DocumentDuplicateIcon,
    ArrowPathRoundedSquareIcon,
    ServerIcon,
    LockClosedIcon,
    GlobeAltIcon,
    CommandLineIcon,
    SignalIcon,
    MusicalNoteIcon,
    SpeakerWaveIcon,
    DocumentTextIcon,
    ChevronDownIcon,
    InformationCircleIcon,
    XMarkIcon,
} from '@heroicons/vue/24/outline';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PromptDialog from '../components/PromptDialog.vue';

const configStore = useConfigStore();
const systemStore = useSystemStore();
const snapshotStore = useSnapshotStore();
const uiStore = useUIStore();

const activeTab = ref<'standard' | 'expert' | 'snapshots'>('standard');
const activeSection = ref('server');
const localRawConfig = ref('');
const localParsedConfig = ref<Record<string, any>>({});
const configMetadata = ref<Record<string, any>>({});
const configSections = ref<Record<string, any>>({});
const sourceTemplates = ref<any[]>([]);

// Dialog State
const showConfirmRestart = ref(false);
const showConfirmRestore = ref(false);
const showConfirmDeleteSnapshot = ref(false);
const showConfirmReset = ref(false);
const showConfirmDeleteSection = ref(false);
const showConfirmDeleteProperty = ref(false);
const showPromptAddSection = ref(false);
const showPromptAddProperty = ref(false);
const showAddSourceDialog = ref(false);

const pendingRestoreId = ref<number | null>(null);
const pendingDeleteSnapshotId = ref<number | null>(null);
const pendingDeleteSection = ref('');
const pendingDeleteProperty = ref({ section: '', key: '' });
const activePromptSection = ref('');

// Source creation state
const selectedSourceType = ref('');
const sourceFormPath = ref('');
const sourceFormParams = ref<Record<string, string>>({});

const sectionIcons: Record<string, any> = {
  server: ServerIcon,
  ssl: LockClosedIcon,
  http: GlobeAltIcon,
  'tcp-control': CommandLineIcon,
  'tcp-streaming': SignalIcon,
  stream: MusicalNoteIcon,
  streaming_client: SpeakerWaveIcon,
  logging: DocumentTextIcon,
};

// Ordered section keys for tab display
const sectionOrder = ['server', 'ssl', 'http', 'tcp-control', 'tcp-streaming', 'stream', 'streaming_client', 'logging'];

const orderedSections = computed(() => {
  return sectionOrder.filter(s => configSections.value[s]);
});

const currentSectionMeta = computed(() => {
  return configSections.value[activeSection.value] || { label: activeSection.value, description: '' };
});

const currentSectionProperties = computed(() => {
  return localParsedConfig.value[activeSection.value] || {};
});

const selectedTemplate = computed(() => {
  return sourceTemplates.value.find((t: any) => t.type === selectedSourceType.value);
});

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
}

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
}

const snapshotName = ref('');
const snapshotDescription = ref('');

const handleCreateSnapshot = async () => {
    if (!snapshotName.value) return;
    try {
        await snapshotStore.createSnapshot(snapshotName.value, snapshotDescription.value);
        snapshotName.value = '';
        snapshotDescription.value = '';
        uiStore.showToast('Snapshot created successfully!', 'success');
    } catch (e: any) {
        uiStore.showToast('Failed to create snapshot: ' + e.message, 'error');
    }
};

const triggerRestoreSnapshot = (id: number) => {
  pendingRestoreId.value = id;
  showConfirmRestore.value = true;
};

const handleRestoreSnapshot = async () => {
    if (pendingRestoreId.value === null) return;
    try {
        await snapshotStore.restoreSnapshot(pendingRestoreId.value);
        await fetchBoth();
        uiStore.showToast('Snapshot restored successfully!', 'success');
    } catch (e: any) {
        uiStore.showToast('Failed to restore snapshot: ' + e.message, 'error');
    }
};

const triggerDeleteSnapshot = (id: number) => {
  pendingDeleteSnapshotId.value = id;
  showConfirmDeleteSnapshot.value = true;
};

const handleDeleteSnapshot = async () => {
    if (pendingDeleteSnapshotId.value === null) return;
    try {
        await snapshotStore.deleteSnapshot(pendingDeleteSnapshotId.value);
        uiStore.showToast('Snapshot deleted', 'info');
    } catch (e: any) {
        uiStore.showToast('Failed to delete snapshot: ' + e.message, 'error');
    }
};

const triggerAddProperty = (section: string) => {
  activePromptSection.value = section;
  showPromptAddProperty.value = true;
};

const handleAddProperty = (key: string) => {
    const section = activePromptSection.value;
    if (!key || !section) return;
    if (!localParsedConfig.value[section]) localParsedConfig.value[section] = {};
    if (localParsedConfig.value[section][key] !== undefined) {
        uiStore.showToast('Property already exists', 'warning');
        return;
    }
    localParsedConfig.value[section][key] = '';
    uiStore.showToast(`Property "${key}" added to [${section}]`, 'success');
};

const handleAddSection = (section: string) => {
    if (!section) return;
    if (localParsedConfig.value[section]) {
        uiStore.showToast('Section already exists', 'warning');
        return;
    }
    localParsedConfig.value[section] = {};
    uiStore.showToast(`Section [${section}] created`, 'success');
};

const triggerRemoveProperty = (section: string, key: string) => {
    pendingDeleteProperty.value = { section, key };
    showConfirmDeleteProperty.value = true;
};

const handleRemoveProperty = () => {
    const { section, key } = pendingDeleteProperty.value;
    if (section && key) {
        delete localParsedConfig.value[section][key];
        uiStore.showToast(`Removed "${key}"`, 'info');
    }
};

const triggerRemoveSection = (section: string) => {
    pendingDeleteSection.value = section;
    showConfirmDeleteSection.value = true;
};

const handleRemoveSection = () => {
    const section = pendingDeleteSection.value;
    if (section) {
        delete localParsedConfig.value[section];
        uiStore.showToast(`Section [${section}] removed`, 'info');
    }
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
        } else {
          throw new Error('Failed to reset');
        }
    } catch (e: any) {
        uiStore.showToast('Failed to reset configuration: ' + e.message, 'error');
    }
};

// Source creation helpers
const openAddSourceDialog = () => {
  selectedSourceType.value = '';
  sourceFormPath.value = '';
  sourceFormParams.value = {};
  showAddSourceDialog.value = true;
};

const selectSourceType = (type: string) => {
  selectedSourceType.value = type;
  const template = sourceTemplates.value.find((t: any) => t.type === type);
  if (template) {
    sourceFormPath.value = template.pathPlaceholder;
    sourceFormParams.value = {};
    for (const p of template.params) {
      sourceFormParams.value[p.key] = p.default || '';
    }
  }
};

const buildSourceUri = (): string => {
  const template = selectedTemplate.value;
  if (!template) return '';
  
  const path = sourceFormPath.value || template.pathPlaceholder;
  let uri = `${template.uriPrefix}/${path}`;
  
  const params: string[] = [];
  for (const p of template.params) {
    const val = sourceFormParams.value[p.key];
    if (val !== undefined && val !== '' && val !== p.default) {
      params.push(`${p.key}=${val}`);
    } else if (p.required && val) {
      params.push(`${p.key}=${val}`);
    }
  }
  
  if (params.length > 0) {
    uri += '?' + params.join('&');
  }
  
  return uri;
};

const addSourceFromTemplate = () => {
  const uri = buildSourceUri();
  if (!uri) return;
  
  if (!localParsedConfig.value.stream) {
    localParsedConfig.value.stream = {};
  }
  
  const current = localParsedConfig.value.stream.source;
  if (Array.isArray(current)) {
    current.push(uri);
  } else if (current) {
    localParsedConfig.value.stream.source = [current, uri];
  } else {
    localParsedConfig.value.stream.source = uri;
  }
  
  showAddSourceDialog.value = false;
  uiStore.showToast('Source added! Save to apply.', 'success');
};

const getMetaForKey = (section: string, key: string) => {
  return configMetadata.value[section]?.[key];
};
</script>

<template>
  <Layout>
      <!-- Main Tabs Navigation -->
      <div class="mb-6 flex space-x-2 bg-slate-200/50 dark:bg-slate-800/50 p-1.5 rounded-2xl w-fit">
          <button 
            @click="activeTab = 'standard'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm',
                activeTab === 'standard' 
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            ]"
          >
              <AdjustmentsHorizontalIcon class="h-4 w-4" />
              <span>Standard</span>
          </button>
          <button 
            @click="activeTab = 'expert'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm',
                activeTab === 'expert' 
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            ]"
          >
              <CodeBracketIcon class="h-4 w-4" />
              <span>Expert</span>
          </button>
          <button 
            @click="activeTab = 'snapshots'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm',
                activeTab === 'snapshots' 
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            ]"
          >
              <ClockIcon class="h-4 w-4" />
              <span>Snapshots</span>
          </button>
      </div>

      <!-- ==================== STANDARD TAB ==================== -->
      <div v-if="activeTab === 'standard'" class="animate-in fade-in slide-in-from-left-4 duration-500">
          
          <!-- Section Sub-Tabs -->
          <div class="mb-6 flex flex-wrap gap-1.5">
              <button
                v-for="sKey in orderedSections"
                :key="sKey"
                @click="activeSection = sKey"
                :class="[
                    'flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 whitespace-nowrap',
                    activeSection === sKey
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : 'bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200'
                ]"
              >
                  <component :is="sectionIcons[sKey] || AdjustmentsHorizontalIcon" class="h-3.5 w-3.5" />
                  <span>{{ configSections[sKey]?.label || sKey }}</span>
              </button>
          </div>

          <!-- Section Content -->
          <Card>
              <template #title>
                  <div class="flex justify-between items-center w-full">
                      <div class="flex items-center space-x-3">
                        <component :is="sectionIcons[activeSection] || AdjustmentsHorizontalIcon" class="h-5 w-5 text-indigo-500" />
                        <div>
                          <span class="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest">{{ currentSectionMeta.label }}</span>
                          <p class="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-0.5">{{ currentSectionMeta.description }}</p>
                        </div>
                      </div>
                      <div class="flex items-center space-x-2">
                          <!-- Add Source button for stream section -->
                          <button v-if="activeSection === 'stream'" @click="openAddSourceDialog" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 rounded-lg transition-colors uppercase tracking-widest border border-emerald-200 dark:border-emerald-800">
                            <PlusIcon class="h-3 w-3 mr-1" />
                            Add Source
                          </button>
                          <button @click="triggerAddProperty(activeSection)" class="inline-flex items-center px-2 py-1 text-[10px] font-black text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors uppercase tracking-widest">
                            <PlusIcon class="h-3 w-3 mr-1" />
                            Add Property
                          </button>
                          <button @click="triggerRemoveSection(activeSection)" class="inline-flex items-center p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors" title="Delete Section">
                            <TrashIcon class="h-4 w-4" />
                          </button>
                      </div>
                  </div>
              </template>
              
              <div class="space-y-5">
                  <div v-if="Object.keys(currentSectionProperties).length === 0" class="text-center py-12 border-2 border-dashed border-slate-100 dark:border-slate-800/50 rounded-xl">
                      <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">No properties defined in this section</p>
                      <p class="text-[10px] text-slate-400 mt-2">Add properties or switch to Expert mode to edit raw config</p>
                  </div>
                  
                  <div v-for="(value, key) in currentSectionProperties" :key="key" 
                    class="grid grid-cols-1 md:grid-cols-4 gap-4 items-start group py-3 px-4 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-all -mx-4">
                      
                      <!-- Label Column -->
                      <div class="md:col-span-1">
                          <div class="flex items-start justify-between">
                              <div class="flex flex-col min-w-0">
                                <label class="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                                  {{ getMetaForKey(activeSection, String(key))?.label || String(key) }}
                                </label>
                                <span v-if="getMetaForKey(activeSection, String(key))?.description" 
                                  class="text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-1">
                                  {{ getMetaForKey(activeSection, String(key))?.description }}
                                </span>
                                <span v-if="getMetaForKey(activeSection, String(key))?.default !== undefined" 
                                  class="text-[9px] text-indigo-400 dark:text-indigo-500 mt-1 font-mono">
                                  default: {{ getMetaForKey(activeSection, String(key))?.default }}
                                </span>
                              </div>
                              <button @click="triggerRemoveProperty(activeSection, String(key))" class="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0 ml-2">
                                   <TrashIcon class="h-3.5 w-3.5" />
                              </button>
                          </div>
                      </div>
                      
                      <!-- Input Column -->
                      <div class="md:col-span-3">
                          <!-- Boolean Toggle -->
                          <div v-if="getMetaForKey(activeSection, String(key))?.type === 'boolean'" class="flex items-center py-1">
                            <button 
                              @click="localParsedConfig[activeSection][key] = String(localParsedConfig[activeSection][key]) === 'true' ? 'false' : 'true'"
                              :class="[
                                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
                                String(localParsedConfig[activeSection][key]) === 'true' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                              ]"
                            >
                              <span :class="[String(localParsedConfig[activeSection][key]) === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                            </button>
                            <span class="ml-3 text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
                              {{ String(localParsedConfig[activeSection][key]) === 'true' ? 'Enabled' : 'Disabled' }}
                            </span>
                          </div>
                          
                          <!-- Select Dropdown -->
                          <div v-else-if="getMetaForKey(activeSection, String(key))?.type === 'select'" class="relative">
                            <select
                              v-model="localParsedConfig[activeSection][String(key)]"
                              class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                            >
                              <option v-for="opt in getMetaForKey(activeSection, String(key))?.options" :key="opt" :value="opt">
                                {{ opt || '(auto)' }}
                              </option>
                            </select>
                            <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>

                          <!-- Number Input -->
                          <input 
                            v-else-if="getMetaForKey(activeSection, String(key))?.type === 'number'"
                            type="number"
                            v-model.number="localParsedConfig[activeSection][String(key)]"
                            :placeholder="String(getMetaForKey(activeSection, String(key))?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                          />
                          
                          <!-- List (array entries, e.g. sources) -->
                          <div v-else-if="Array.isArray(value) || getMetaForKey(activeSection, String(key))?.type === 'list'" class="space-y-2">
                              <div v-for="(_item, idx) in (Array.isArray(value) ? value : [value])" :key="idx" class="flex space-x-2">
                                  <input 
                                    v-model="(Array.isArray(value) ? localParsedConfig[activeSection][String(key)] : localParsedConfig[activeSection])[idx === undefined ? String(key) : idx]"
                                    :placeholder="getMetaForKey(activeSection, String(key))?.default ?? ''"
                                    class="flex-1 text-sm font-medium px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white font-mono text-[12px]"
                                  />
                                  <button v-if="Array.isArray(value)" @click="localParsedConfig[activeSection][String(key)].splice(idx, 1)" class="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                                    <TrashIcon class="h-4 w-4" />
                                  </button>
                              </div>
                              <button v-if="Array.isArray(value)" @click="localParsedConfig[activeSection][String(key)].push('')" class="inline-flex items-center text-[10px] font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 uppercase tracking-widest mt-1">
                                <PlusIcon class="h-3 w-3 mr-1" />
                                Add Entry
                              </button>
                              <button v-else @click="localParsedConfig[activeSection][String(key)] = [value, '']" class="inline-flex items-center text-[10px] font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 uppercase tracking-widest mt-1">
                                <PlusIcon class="h-3 w-3 mr-1" />
                                Convert to List
                              </button>
                          </div>
                          
                          <!-- Default Text Input -->
                          <input 
                            v-else
                            v-model="localParsedConfig[activeSection][String(key)]"
                            :placeholder="String(getMetaForKey(activeSection, String(key))?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                          />
                      </div>
                  </div>
              </div>
          </Card>

          <!-- Bottom Actions -->
          <div class="mt-8 mb-24 flex flex-col space-y-4">
              <button @click="showPromptAddSection = true" class="w-full py-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 dark:text-slate-500 hover:border-indigo-500/50 hover:text-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 transition-all flex flex-col justify-center items-center group">
                  <div class="p-2 bg-slate-100 dark:bg-slate-800 rounded-full group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors mb-1">
                    <PlusIcon class="h-5 w-5" />
                  </div>
                  <span class="text-[10px] font-black uppercase tracking-widest">Add New Section</span>
              </button>
              
              <button @click="showConfirmReset = true" class="w-full py-3 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 hover:text-amber-500 hover:bg-amber-500/5 transition-all flex justify-center items-center space-x-2">
                  <ArrowPathRoundedSquareIcon class="h-4 w-4" />
                  <span class="text-[10px] font-black uppercase tracking-widest">Reset Configuration to Default</span>
              </button>
          </div>

           <div class="mt-6 flex justify-end fixed bottom-8 right-8 z-30">
              <button 
                  @click="saveParsed" 
                  :disabled="configStore.loading"
                  class="flex items-center space-x-2 px-8 py-4 rounded-2xl shadow-2xl shadow-indigo-600/40 text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-1 active:scale-95 disabled:opacity-50 transition-all duration-300"
              >
                  <ArrowPathIcon v-if="configStore.loading" class="h-5 w-5 animate-spin" />
                  <span>SAVE CONFIGURATION</span>
              </button>
          </div>
      </div>

      <!-- ==================== EXPERT TAB ==================== -->
      <div v-else-if="activeTab === 'expert'" class="animate-in fade-in slide-in-from-right-4 duration-500">
          <Card>
              <template #title>
                <div class="flex items-center justify-between w-full">
                  <div class="flex items-center space-x-2">
                    <CodeBracketIcon class="h-5 w-5 text-indigo-500" />
                    <span class="font-black text-sm uppercase tracking-widest text-slate-800 dark:text-white">Raw Editor</span>
                  </div>
                </div>
              </template>
              <div class="space-y-6">
                  <p class="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      Direct access to <code>snapserver.conf</code>
                  </p>
                  <div class="relative group">
                    <div class="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-10 group-focus-within:opacity-25 transition duration-500"></div>
                    <textarea 
                        v-model="localRawConfig" 
                        class="relative w-full h-[600px] font-mono text-xs px-6 py-6 bg-slate-900 border-none rounded-2xl text-indigo-100 focus:ring-0 outline-none leading-relaxed selection:bg-indigo-500/30"
                        spellcheck="false"
                    ></textarea>
                  </div>
                  <div class="flex justify-end">
                      <button 
                          @click="saveRaw" 
                          :disabled="configStore.loading"
                          class="px-8 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition-all"
                      >
                          Apply Raw Changes
                      </button>
                  </div>
              </div>
          </Card>
      </div>

      <!-- ==================== SNAPSHOTS TAB ==================== -->
      <div v-else-if="activeTab === 'snapshots'" class="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div class="lg:col-span-1">
                  <Card title="Checkpoint">
                      <template #icon>
                        <DocumentDuplicateIcon class="h-5 w-5 text-indigo-500" />
                      </template>
                      <div class="space-y-5">
                          <div>
                              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Identifier</label>
                              <input v-model="snapshotName" type="text" placeholder="e.g. Pre-optimization" 
                                class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white">
                          </div>
                          <div>
                              <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Notes</label>
                              <textarea v-model="snapshotDescription" placeholder="Briefly describe why this checkpoint is being made..." 
                                class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white h-32 resize-none"></textarea>
                          </div>
                          <button 
                            @click="handleCreateSnapshot"
                            :disabled="snapshotStore.loading || !snapshotName"
                            class="w-full px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 disabled:opacity-50 transition-all active:scale-95"
                          >
                            Capture State
                          </button>
                      </div>
                  </Card>
              </div>
              <div class="lg:col-span-2">
                  <Card title="Version History">
                      <template #icon>
                        <ClockIcon class="h-5 w-5 text-blue-500" />
                      </template>
                      <div v-if="snapshotStore.loading && snapshotStore.snapshots.length === 0" class="flex justify-center py-12">
                          <ArrowPathIcon class="h-8 w-8 text-indigo-500 animate-spin" />
                      </div>
                      <div v-else-if="snapshotStore.snapshots.length === 0" class="text-center py-24 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-800/50">
                          <p class="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">No snapshots archived</p>
                      </div>
                      <div v-else class="space-y-4">
                          <div v-for="snapshot in snapshotStore.snapshots" :key="snapshot.id" 
                            class="p-5 border border-slate-100 dark:border-slate-800 rounded-2xl flex justify-between items-center hover:bg-slate-50 dark:hover:bg-slate-800 transition-all hover:shadow-lg hover:shadow-indigo-500/5 group">
                              <div class="space-y-1">
                                  <h4 class="font-black text-slate-800 dark:text-white uppercase tracking-tight">{{ snapshot.name }}</h4>
                                  <p v-if="snapshot.description" class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ snapshot.description }}</p>
                                  <div class="flex items-center text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded w-fit mt-2 uppercase tracking-widest">
                                    {{ new Date(snapshot.timestamp).toLocaleString() }}
                                  </div>
                              </div>
                              <div class="flex space-x-2">
                                  <button @click="triggerRestoreSnapshot(snapshot.id)" 
                                    class="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 rounded-lg hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all shadow-sm active:scale-95">
                                      Restore
                                  </button>
                                  <button @click="triggerDeleteSnapshot(snapshot.id)"
                                    class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all group-hover:opacity-100 md:opacity-0">
                                      <TrashIcon class="h-5 w-5" />
                                  </button>
                              </div>
                          </div>
                      </div>
                  </Card>
              </div>
          </div>
      </div>

      <!-- ==================== ADD SOURCE DIALOG ==================== -->
      <Teleport to="body">
        <Transition
          enter-active-class="transition ease-out duration-300"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition ease-in duration-200"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div v-if="showAddSourceDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div class="fixed inset-0 bg-slate-900/75 backdrop-blur-sm" @click="showAddSourceDialog = false"></div>
            <div class="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
              
              <!-- Header -->
              <div class="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                <div>
                  <h3 class="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest">Add Audio Source</h3>
                  <p class="text-[10px] text-slate-400 mt-0.5">Select a source type and configure its parameters</p>
                </div>
                <button @click="showAddSourceDialog = false" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all">
                  <XMarkIcon class="h-5 w-5" />
                </button>
              </div>

              <div class="p-6">
                <!-- Step 1: Source Type Selection -->
                <div v-if="!selectedSourceType">
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <button
                      v-for="tmpl in sourceTemplates"
                      :key="tmpl.type"
                      @click="selectSourceType(tmpl.type)"
                      class="flex flex-col items-center p-4 rounded-xl border-2 border-slate-100 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-500/10 transition-all group text-center"
                    >
                      <div class="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors mb-2">
                        <MusicalNoteIcon class="h-5 w-5 text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                      </div>
                      <span class="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">{{ tmpl.label }}</span>
                      <span class="text-[9px] text-slate-400 mt-1 leading-tight">{{ tmpl.description.split('.')[0] }}</span>
                    </button>
                  </div>
                </div>

                <!-- Step 2: Parameter Form -->
                <div v-else-if="selectedTemplate">
                  <button @click="selectedSourceType = ''" class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-4 hover:text-indigo-700 transition-colors">
                    ← Back to source types
                  </button>

                  <div class="mb-4 p-3 bg-indigo-50/50 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-800 rounded-xl">
                    <div class="flex items-start space-x-2">
                      <InformationCircleIcon class="h-4 w-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <span class="text-xs font-bold text-indigo-700 dark:text-indigo-300">{{ selectedTemplate.label }}</span>
                        <p class="text-[10px] text-indigo-600/70 dark:text-indigo-400/70 mt-0.5">{{ selectedTemplate.description }}</p>
                        <p v-if="selectedTemplate.fixedSampleFormat" class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-semibold">
                          ⚠ Fixed sample format: {{ selectedTemplate.fixedSampleFormat }}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <!-- Path -->
                    <div>
                      <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                        Path / Host
                      </label>
                      <input
                        v-model="sourceFormPath"
                        :placeholder="selectedTemplate.pathPlaceholder"
                        class="w-full text-sm font-mono px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                      />
                    </div>

                    <!-- Parameters -->
                    <div v-for="param in selectedTemplate.params" :key="param.key">
                      <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                        {{ param.label }}
                        <span v-if="param.required" class="text-red-400 ml-0.5">*</span>
                      </label>
                      <span class="text-[9px] text-slate-400 block mb-1.5">{{ param.description }}</span>
                      
                      <!-- Boolean param -->
                      <div v-if="param.type === 'boolean'" class="flex items-center">
                        <button 
                          @click="sourceFormParams[param.key] = sourceFormParams[param.key] === 'true' ? 'false' : 'true'"
                          :class="[
                            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                            sourceFormParams[param.key] === 'true' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                          ]"
                        >
                          <span :class="[sourceFormParams[param.key] === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200']" />
                        </button>
                        <span class="ml-3 text-xs text-slate-500 font-bold uppercase tracking-widest">
                          {{ sourceFormParams[param.key] === 'true' ? 'Yes' : 'No' }}
                        </span>
                      </div>
                      
                      <!-- Select param -->
                      <div v-else-if="param.type === 'select'" class="relative">
                        <select
                          v-model="sourceFormParams[param.key]"
                          class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                        >
                          <option v-for="opt in param.options" :key="opt" :value="opt">{{ opt }}</option>
                        </select>
                        <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                      
                      <!-- Number param -->
                      <input 
                        v-else-if="param.type === 'number'"
                        type="number"
                        v-model="sourceFormParams[param.key]"
                        :placeholder="param.default || ''"
                        class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                      />
                      
                      <!-- Text param -->
                      <input 
                        v-else
                        v-model="sourceFormParams[param.key]"
                        :placeholder="param.placeholder || param.default || ''"
                        class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                      />
                    </div>
                  </div>

                  <!-- URI Preview -->
                  <div class="mt-5 p-3 bg-slate-900 rounded-xl">
                    <label class="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Generated URI</label>
                    <code class="text-[11px] text-indigo-300 font-mono break-all leading-relaxed">{{ buildSourceUri() }}</code>
                  </div>

                  <!-- Actions -->
                  <div class="flex justify-end space-x-3 mt-5">
                    <button @click="showAddSourceDialog = false" class="px-5 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-widest hover:text-slate-700 dark:hover:text-white transition-colors">
                      Cancel
                    </button>
                    <button 
                      @click="addSourceFromTemplate"
                      :disabled="!sourceFormParams['name']"
                      class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition-all"
                    >
                      Add Source
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </Teleport>

      <!-- ==================== DIALOGS ==================== -->
      <ConfirmDialog
        v-model="showConfirmRestart"
        title="Restart Snapserver?"
        message="Configuration saved! Restart now to apply changes?"
        confirmText="Restart Now"
        @confirm="handleRestartConfirm"
      />

      <ConfirmDialog
        v-model="showConfirmRestore"
        title="Restore Snapshot?"
        message="Are you sure you want to restore this snapshot? Current configuration will be overwritten."
        type="danger"
        confirmText="Overwrite & Restore"
        @confirm="handleRestoreSnapshot"
      />

      <ConfirmDialog
        v-model="showConfirmDeleteSnapshot"
        title="Delete Snapshot?"
        message="This action cannot be undone."
        type="danger"
        confirmText="Delete Permanently"
        @confirm="handleDeleteSnapshot"
      />

      <ConfirmDialog
        v-model="showConfirmReset"
        title="Reset to Defaults?"
        message="This will wipe your current configuration base and restore it to the default Snapserver values. Use with caution!"
        type="danger"
        confirmText="Reset Configuration"
        @confirm="handleResetToDefault"
      />

      <ConfirmDialog
        v-model="showConfirmDeleteSection"
        title="Delete Section?"
        :message="`Are you sure you want to delete the entire [${pendingDeleteSection}] section?`"
        type="danger"
        confirmText="Delete Section"
        @confirm="handleRemoveSection"
      />

      <ConfirmDialog
        v-model="showConfirmDeleteProperty"
        title="Delete Property?"
        :message="`Remove ${pendingDeleteProperty.key} from [${pendingDeleteProperty.section}]?`"
        type="danger"
        confirmText="Delete Property"
        @confirm="handleRemoveProperty"
      />

      <PromptDialog
        v-model="showPromptAddSection"
        title="Add Section"
        message="Enter the name for the new configuration section."
        placeholder="e.g. custom_settings"
        @confirm="handleAddSection"
      />

      <PromptDialog
        v-model="showPromptAddProperty"
        title="Add Property"
        :message="`Enter property name for [${activePromptSection}]:`"
        placeholder="e.g. custom_key"
        @confirm="handleAddProperty"
      />
  </Layout>
</template>
