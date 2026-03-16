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
    ShieldCheckIcon,
    ArrowDownTrayIcon,
} from '@heroicons/vue/24/outline';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PromptDialog from '../components/PromptDialog.vue';

const configStore = useConfigStore();
const systemStore = useSystemStore();
const snapshotStore = useSnapshotStore();
const uiStore = useUIStore();

const activeTab = ref<'standard' | 'expert' | 'snapshots' | 'security'>('standard');
const activeSection = ref('server');
const localRawConfig = ref('');
const localParsedConfig = ref<Record<string, any>>({});
const configMetadata = ref<Record<string, any>>({});
const configSections = ref<Record<string, any>>({});
const sourceTemplates = ref<any[]>([]);

// Tracks which properties are "enabled" (will be saved)
const enabledProperties = ref<Record<string, Record<string, boolean>>>({});

// Dialog State
const showConfirmRestart = ref(false);
const showConfirmRestore = ref(false);
const showConfirmDeleteSnapshot = ref(false);
const showConfirmReset = ref(false);
const showPromptAddProperty = ref(false);
const showAddSourceDialog = ref(false);

const pendingRestoreId = ref<number | null>(null);
const pendingDeleteSnapshotId = ref<number | null>(null);
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

const sectionOrder = ['server', 'ssl', 'http', 'tcp-control', 'tcp-streaming', 'stream', 'streaming_client', 'logging'];

const orderedSections = computed(() => {
  return sectionOrder.filter(s => configSections.value[s]);
});

const currentSectionMeta = computed(() => {
  return configSections.value[activeSection.value] || { label: activeSection.value, description: '' };
});

const selectedTemplate = computed(() => {
  return sourceTemplates.value.find((t: any) => t.type === selectedSourceType.value);
});

// Extract the name= parameter from a source URI
const extractSourceName = (uri: string): string => {
  const match = uri.match(/[?&]name=([^&]+)/);
  return match ? decodeURIComponent(match[1]!) : '';
};

// Detect the source type from a URI for display
const getSourceType = (uri: string): string => {
  if (uri.startsWith('pipe://')) return 'Pipe';
  if (uri.startsWith('librespot://')) return 'Spotify';
  if (uri.startsWith('airplay://')) return 'AirPlay';
  if (uri.startsWith('process://') && uri.includes('ffmpeg')) return 'FFmpeg';
  if (uri.startsWith('process://')) return 'Process';
  if (uri.startsWith('file://')) return 'File';
  if (uri.startsWith('tcp://')) return 'TCP';
  if (uri.startsWith('alsa://')) return 'ALSA';
  if (uri.startsWith('meta://')) return 'Meta';
  if (uri.startsWith('jack://')) return 'JACK';
  return 'Source';
};

// Get all source names from the current config for the default_source dropdown
const availableSourceNames = computed((): string[] => {
  const sources = localParsedConfig.value?.stream?.source;
  if (!sources) return [];
  const list = Array.isArray(sources) ? sources : [sources];
  return list.map((s: string) => extractSourceName(s)).filter((n: string) => n);
});

// Returns all property keys for the active section: metadata keys + any extra keys from the config
const allPropertyKeys = computed(() => {
  const section = activeSection.value;
  const metaKeys = Object.keys(configMetadata.value[section] || {});
  const configKeys = Object.keys(localParsedConfig.value[section] || {});
  const combined = new Set([...metaKeys, ...configKeys]);
  return Array.from(combined);
});

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

const isPropertyEnabled = (section: string, key: string) => {
  return enabledProperties.value[section]?.[key] ?? false;
};

const toggleProperty = (section: string, key: string) => {
  const meta = configMetadata.value[section]?.[key];
  const currentlyEnabled = isPropertyEnabled(section, key);
  
  if (!enabledProperties.value[section]) {
    enabledProperties.value[section] = {};
  }
  
  if (currentlyEnabled) {
    // Disable: remove from localParsedConfig
    enabledProperties.value[section][key] = false;
    if (localParsedConfig.value[section]) {
      delete localParsedConfig.value[section][key];
    }
  } else {
    // Enable: add to localParsedConfig with default value
    enabledProperties.value[section][key] = true;
    if (!localParsedConfig.value[section]) {
      localParsedConfig.value[section] = {};
    }
    const defaultVal = meta?.default ?? '';
    localParsedConfig.value[section][key] = String(defaultVal);
  }
};

const getPropertyValue = (section: string, key: string) => {
  return localParsedConfig.value[section]?.[key] ?? '';
};

const setPropertyValue = (section: string, key: string, value: any) => {
  if (!localParsedConfig.value[section]) {
    localParsedConfig.value[section] = {};
  }
  localParsedConfig.value[section][key] = value;
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

const snapshotName = ref('');
const snapshotDescription = ref('');

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const isSavingPassword = ref(false);
const isExporting = ref(false);

const handleChangePassword = async () => {
  if (newPassword.value !== confirmPassword.value) {
    uiStore.showToast('Passwords do not match', 'error');
    return;
  }
  if (!currentPassword.value || !newPassword.value) {
    uiStore.showToast('Current and new passwords are required', 'error');
    return;
  }
  isSavingPassword.value = true;
  try {
    await fetchApi('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    });
    uiStore.showToast('Password changed successfully', 'success');
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to change password', 'error');
  } finally {
    isSavingPassword.value = false;
  }
};

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
    if (!enabledProperties.value[section]) enabledProperties.value[section] = {};
    enabledProperties.value[section][key] = true;
    uiStore.showToast(`Property "${key}" added to [${section}]`, 'success');
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
  
  if (template.type === 'ffmpeg_radio') {
    // Special handling: build ffmpeg params from stream URL
    const streamUrl = sourceFormParams.value['_stream_url'] || '';
    const name = sourceFormParams.value['name'] || 'Radio';
    
    // Build the ffmpeg args: -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i <url> -f s16le -ar <rate> -ac <channels> -
    const sampleformat = sourceFormParams.value['sampleformat'] || '48000:16:2';
    const [rate, , channels] = sampleformat.split(':');
    const ffmpegArgs = `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i ${streamUrl} -f s16le -ar ${rate || '48000'} -ac ${channels || '2'} -`;
    const encodedParams = ffmpegArgs.replace(/ /g, '%20');
    
    params.push(`name=${name}`);
    
    // Add standard params (codec, sampleformat, etc.) but skip _stream_url and name
    for (const p of template.params) {
      if (p.key === '_stream_url' || p.key === 'name') continue;
      const val = sourceFormParams.value[p.key];
      if (val !== undefined && val !== '' && val !== p.default) {
        params.push(`${p.key}=${val}`);
      } else if (p.required && val) {
        params.push(`${p.key}=${val}`);
      }
    }
    
    params.push(`params=${encodedParams}`);
  } else {
    // Standard URI building
    for (const p of template.params) {
      const val = sourceFormParams.value[p.key];
      if (val !== undefined && val !== '' && val !== p.default) {
        params.push(`${p.key}=${val}`);
      } else if (p.required && val) {
        params.push(`${p.key}=${val}`);
      }
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
  
  // Ensure source is marked as enabled
  if (!enabledProperties.value.stream) enabledProperties.value.stream = {};
  enabledProperties.value.stream.source = true;
  
  showAddSourceDialog.value = false;
  uiStore.showToast('Source added! Save to apply.', 'success');
};

const getMetaForKey = (section: string, key: string) => {
  return configMetadata.value[section]?.[key];
};

const removeSourceEntry = (idx: number) => {
  const sources = localParsedConfig.value.stream?.source;
  if (Array.isArray(sources)) {
    sources.splice(idx, 1);
    if (sources.length === 1) {
      localParsedConfig.value.stream.source = sources[0];
    }
  }
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
          <button 
            @click="activeTab = 'security'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm',
                activeTab === 'security' 
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            ]"
          >
              <ShieldCheckIcon class="h-4 w-4" />
              <span>Security & Backup</span>
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
                      <div v-if="activeSection !== 'stream'" class="flex items-center space-x-2">
                          <button @click="triggerAddProperty(activeSection)" class="inline-flex items-center px-2 py-1 text-[10px] font-black text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors uppercase tracking-widest" title="Add custom property">
                            <PlusIcon class="h-3 w-3 mr-1" />
                            Custom
                          </button>
                      </div>
                  </div>
              </template>
              
              <div v-if="activeSection === 'stream'">
                  <!-- ==== SUB-SECTION 1: Audio Sources ==== -->
                  <div class="mb-2">
                    <div class="flex items-center justify-between mb-4">
                      <div class="flex items-center space-x-2">
                        <MusicalNoteIcon class="h-4 w-4 text-emerald-500" />
                        <h3 class="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Audio Sources</h3>
                        <span v-if="availableSourceNames.length" class="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-[10px] font-black rounded-full">{{ availableSourceNames.length }}</span>
                      </div>
                      <button @click="openAddSourceDialog" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 rounded-lg transition-colors uppercase tracking-widest border border-emerald-200 dark:border-emerald-800">
                        <PlusIcon class="h-3 w-3 mr-1" />
                        Add Source
                      </button>
                    </div>
                    
                    <div v-if="!localParsedConfig.stream?.source" class="text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-700/50 rounded-xl">
                      <MusicalNoteIcon class="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                      <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">No sources configured</p>
                      <p class="text-[10px] text-slate-400 mt-1">Use "Add Source" to create your first audio stream</p>
                    </div>
                    
                    <div v-else class="space-y-3">
                      <div v-for="(_item, idx) in (Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source : [localParsedConfig.stream.source])" :key="idx"
                        class="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30 overflow-hidden">
                        <!-- Source header with name badge -->
                        <div class="flex items-center justify-between px-3 py-2 bg-slate-100/50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/50">
                          <div class="flex items-center space-x-2">
                            <span class="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[10px] font-black uppercase tracking-widest rounded-md">
                              {{ getSourceType(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) }}
                            </span>
                            <span class="text-sm font-bold text-slate-700 dark:text-slate-200">
                              {{ extractSourceName(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) || 'Unnamed' }}
                            </span>
                          </div>
                          <button v-if="Array.isArray(localParsedConfig.stream.source)" @click="removeSourceEntry(idx as number)" class="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors" title="Remove source">
                            <TrashIcon class="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <!-- Source URI input -->
                        <div class="px-3 py-2">
                          <input 
                            v-if="Array.isArray(localParsedConfig.stream.source)"
                            v-model="localParsedConfig.stream.source[idx]"
                            class="w-full text-[11px] font-mono font-medium px-3 py-1.5 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-slate-300"
                          />
                          <input 
                            v-else
                            :value="localParsedConfig.stream.source"
                            @input="setPropertyValue('stream', 'source', ($event.target as HTMLInputElement).value)"
                            class="w-full text-[11px] font-mono font-medium px-3 py-1.5 bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-slate-300"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- ==== DIVIDER ==== -->
                  <div class="border-t border-slate-200 dark:border-slate-700/50 my-6"></div>

                  <!-- ==== SUB-SECTION 2: Stream Settings ==== -->
                  <div>
                    <div class="flex items-center justify-between mb-4">
                      <div class="flex items-center space-x-2">
                        <AdjustmentsHorizontalIcon class="h-4 w-4 text-indigo-500" />
                        <h3 class="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Stream Settings</h3>
                      </div>
                      <button @click="triggerAddProperty('stream')" class="inline-flex items-center px-2 py-1 text-[10px] font-black text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition-colors uppercase tracking-widest" title="Add custom property">
                        <PlusIcon class="h-3 w-3 mr-1" />
                        Custom
                      </button>
                    </div>
                    
                    <div class="space-y-1">
                      <div v-for="key in allPropertyKeys.filter(k => k !== 'source')" :key="key"
                        :class="[
                          'grid grid-cols-1 md:grid-cols-12 gap-3 items-start py-3 px-4 rounded-xl transition-all -mx-4',
                          isPropertyEnabled('stream', key)
                            ? 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                            : 'opacity-40 hover:opacity-60'
                        ]">
                        <!-- Enable/Disable Toggle -->
                        <div class="md:col-span-1 flex items-center pt-1">
                          <button 
                            @click="toggleProperty('stream', key)"
                            :class="[
                              'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                              isPropertyEnabled('stream', key) ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                            ]"
                            :title="isPropertyEnabled('stream', key) ? 'Disable this property' : 'Enable this property'"
                          >
                            <span :class="[isPropertyEnabled('stream', key) ? 'translate-x-4' : 'translate-x-0', 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                          </button>
                        </div>
                        <!-- Label Column -->
                        <div class="md:col-span-3">
                          <div class="flex flex-col min-w-0">
                            <label class="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                              {{ getMetaForKey('stream', key)?.label || key }}
                            </label>
                            <span v-if="getMetaForKey('stream', key)?.description" 
                              class="text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-0.5">
                              {{ getMetaForKey('stream', key)?.description }}
                            </span>
                            <span v-if="getMetaForKey('stream', key)?.default !== undefined" 
                              class="text-[9px] text-indigo-400/70 dark:text-indigo-500/70 mt-0.5 font-mono">
                              default: {{ getMetaForKey('stream', key)?.default }}
                            </span>
                          </div>
                        </div>
                        <!-- Input Column -->
                        <div class="md:col-span-8">
                          <!-- DEFAULT_SOURCE: Select dropdown from available source names -->
                          <div v-if="key === 'default_source' && isPropertyEnabled('stream', key)" class="relative">
                            <select
                              :value="getPropertyValue('stream', key)"
                              @change="setPropertyValue('stream', key, ($event.target as HTMLSelectElement).value)"
                              class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                            >
                              <option value="">(auto — first non-meta source)</option>
                              <option v-for="sName in availableSourceNames" :key="sName" :value="sName">
                                {{ sName }}
                              </option>
                            </select>
                            <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>
                          
                          <!-- DISABLED property: show default as read-only -->
                          <div v-else-if="!isPropertyEnabled('stream', key)" class="py-1">
                            <span class="text-xs text-slate-400 font-mono">
                              {{ getMetaForKey('stream', key)?.default ?? '(empty)' }}
                            </span>
                          </div>

                          <!-- Boolean Toggle -->
                          <div v-else-if="getMetaForKey('stream', key)?.type === 'boolean'" class="flex items-center py-1">
                            <button 
                              @click="setPropertyValue('stream', key, String(getPropertyValue('stream', key)) === 'true' ? 'false' : 'true')"
                              :class="[
                                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
                                String(getPropertyValue('stream', key)) === 'true' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                              ]"
                            >
                              <span :class="[String(getPropertyValue('stream', key)) === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                            </button>
                            <span class="ml-3 text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
                              {{ String(getPropertyValue('stream', key)) === 'true' ? 'Enabled' : 'Disabled' }}
                            </span>
                          </div>
                          
                          <!-- Select Dropdown -->
                          <div v-else-if="getMetaForKey('stream', key)?.type === 'select'" class="relative">
                            <select
                              :value="getPropertyValue('stream', key)"
                              @change="setPropertyValue('stream', key, ($event.target as HTMLSelectElement).value)"
                              class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                            >
                              <option v-for="opt in getMetaForKey('stream', key)?.options" :key="opt" :value="opt">
                                {{ opt || '(auto)' }}
                              </option>
                            </select>
                            <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>

                          <!-- Number Input -->
                          <input 
                            v-else-if="getMetaForKey('stream', key)?.type === 'number'"
                            type="number"
                            :value="getPropertyValue('stream', key)"
                            @input="setPropertyValue('stream', key, ($event.target as HTMLInputElement).value)"
                            :placeholder="String(getMetaForKey('stream', key)?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                          />
                          
                          <!-- Default Text Input -->
                          <input 
                            v-else
                            :value="getPropertyValue('stream', key)"
                            @input="setPropertyValue('stream', key, ($event.target as HTMLInputElement).value)"
                            :placeholder="String(getMetaForKey('stream', key)?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
              </div>

              <!-- ==== NON-STREAM SECTIONS: Standard property loop ==== -->
              <div v-else class="space-y-1">
                  <div v-if="allPropertyKeys.length === 0" class="text-center py-12 border-2 border-dashed border-slate-100 dark:border-slate-800/50 rounded-xl">
                      <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">No properties available for this section</p>
                  </div>
                  
                  <div v-for="key in allPropertyKeys" :key="key" 
                    :class="[
                      'grid grid-cols-1 md:grid-cols-12 gap-3 items-start py-3 px-4 rounded-xl transition-all -mx-4',
                      isPropertyEnabled(activeSection, key)
                        ? 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                        : 'opacity-40 hover:opacity-60'
                    ]">
                      
                      <!-- Enable/Disable Toggle (col 1) -->
                      <div class="md:col-span-1 flex items-center pt-1">
                        <button 
                          @click="toggleProperty(activeSection, key)"
                          :class="[
                            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                            isPropertyEnabled(activeSection, key) ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                          ]"
                          :title="isPropertyEnabled(activeSection, key) ? 'Disable this property' : 'Enable this property'"
                        >
                          <span :class="[isPropertyEnabled(activeSection, key) ? 'translate-x-4' : 'translate-x-0', 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                        </button>
                      </div>

                      <!-- Label Column (col 2-4) -->
                      <div class="md:col-span-3">
                          <div class="flex flex-col min-w-0">
                            <label class="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                              {{ getMetaForKey(activeSection, key)?.label || key }}
                            </label>
                            <span v-if="getMetaForKey(activeSection, key)?.description" 
                              class="text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-0.5">
                              {{ getMetaForKey(activeSection, key)?.description }}
                            </span>
                            <span v-if="getMetaForKey(activeSection, key)?.default !== undefined" 
                              class="text-[9px] text-indigo-400/70 dark:text-indigo-500/70 mt-0.5 font-mono">
                              default: {{ getMetaForKey(activeSection, key)?.default }}
                            </span>
                          </div>
                      </div>
                      
                      <!-- Input Column (col 5-12) -->
                      <div class="md:col-span-8">
                          <!-- DISABLED property: show default as read-only -->
                          <div v-if="!isPropertyEnabled(activeSection, key)" class="py-1">
                            <span class="text-xs text-slate-400 font-mono">
                              {{ getMetaForKey(activeSection, key)?.default ?? '(empty)' }}
                            </span>
                          </div>

                          <!-- Boolean Toggle -->
                          <div v-else-if="getMetaForKey(activeSection, key)?.type === 'boolean'" class="flex items-center py-1">
                            <button 
                              @click="setPropertyValue(activeSection, key, String(getPropertyValue(activeSection, key)) === 'true' ? 'false' : 'true')"
                              :class="[
                                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
                                String(getPropertyValue(activeSection, key)) === 'true' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                              ]"
                            >
                              <span :class="[String(getPropertyValue(activeSection, key)) === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                            </button>
                            <span class="ml-3 text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
                              {{ String(getPropertyValue(activeSection, key)) === 'true' ? 'Enabled' : 'Disabled' }}
                            </span>
                          </div>
                          
                          <!-- Select Dropdown -->
                          <div v-else-if="getMetaForKey(activeSection, key)?.type === 'select'" class="relative">
                            <select
                              :value="getPropertyValue(activeSection, key)"
                              @change="setPropertyValue(activeSection, key, ($event.target as HTMLSelectElement).value)"
                              class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                            >
                              <option v-for="opt in getMetaForKey(activeSection, key)?.options" :key="opt" :value="opt">
                                {{ opt || '(auto)' }}
                              </option>
                            </select>
                            <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                          </div>

                          <!-- Number Input -->
                          <input 
                            v-else-if="getMetaForKey(activeSection, key)?.type === 'number'"
                            type="number"
                            :value="getPropertyValue(activeSection, key)"
                            @input="setPropertyValue(activeSection, key, ($event.target as HTMLInputElement).value)"
                            :placeholder="String(getMetaForKey(activeSection, key)?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                          />
                          
                          <!-- Default Text Input -->
                          <input 
                            v-else
                            :value="getPropertyValue(activeSection, key)"
                            @input="setPropertyValue(activeSection, key, ($event.target as HTMLInputElement).value)"
                            :placeholder="String(getMetaForKey(activeSection, key)?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                          />
                      </div>
                  </div>
              </div>
          </Card>

          <!-- Bottom Actions -->
          <div class="mt-8 mb-24 flex justify-center">
              <button @click="showConfirmReset = true" class="py-3 px-6 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 hover:text-amber-500 hover:bg-amber-500/5 transition-all flex items-center space-x-2">
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

      <!-- ==================== SECURITY & BACKUP TAB ==================== -->
      <div v-else-if="activeTab === 'security'" class="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
              <!-- Change Password -->
              <Card title="Change Administrator Password">
                  <template #icon>
                    <LockClosedIcon class="h-5 w-5 text-rose-500" />
                  </template>
                  <div class="space-y-5">
                      <div>
                          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Current Password</label>
                          <input v-model="currentPassword" type="password" placeholder="Enter current password" 
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all dark:text-white">
                      </div>
                      <div>
                          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">New Password</label>
                          <input v-model="newPassword" type="password" placeholder="Enter new password" 
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all dark:text-white">
                      </div>
                      <div>
                          <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Confirm New Password</label>
                          <input v-model="confirmPassword" type="password" placeholder="Re-enter new password" 
                            class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none transition-all dark:text-white">
                      </div>
                      <button 
                        @click="handleChangePassword"
                        :disabled="isSavingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword"
                        class="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-rose-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 shadow-lg shadow-rose-500/20 disabled:opacity-50 transition-all active:scale-95"
                      >
                        <ArrowPathIcon v-if="isSavingPassword" class="h-4 w-4 animate-spin" />
                        <span>Update Password</span>
                      </button>
                  </div>
              </Card>

              <!-- Export Backup -->
              <Card title="Export Server Backup">
                  <template #icon>
                    <ArrowDownTrayIcon class="h-5 w-5 text-emerald-500" />
                  </template>
                  <div class="space-y-5">
                      <p class="text-sm font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                          Download a complete backup of your Snapcast Manager configuration. 
                          This <span class="text-emerald-500 font-bold">.tar.gz</span> archive includes:
                      </p>
                      <ul class="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-2 mb-6">
                          <li class="flex items-center"><ShieldCheckIcon class="h-4 w-4 mr-2 text-indigo-500" /> Administrator Account</li>
                          <li class="flex items-center"><ClockIcon class="h-4 w-4 mr-2 text-blue-500" /> Saved Snapshots</li>
                          <li class="flex items-center"><AdjustmentsHorizontalIcon class="h-4 w-4 mr-2 text-rose-500" /> Snapserver Configuration</li>
                      </ul>
                      
                      <div class="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800/50 p-4 rounded-xl">
                          <p class="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">Restore Instructions</p>
                          <p class="text-xs text-amber-600 dark:text-amber-500 mt-1">Keep this file safe. When reinstalling Snapcast Manager on a new device, you can use the flag <code class="bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 rounded text-amber-800 dark:text-amber-300 font-mono">--restore /path/to/backup.tar.gz</code> during setup to restore everything magically.</p>
                      </div>

                      <button 
                        @click="handleExportBackup"
                        :disabled="isExporting"
                        class="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95 mt-4"
                      >
                        <ArrowPathIcon v-if="isExporting" class="h-4 w-4 animate-spin" />
                        <ArrowDownTrayIcon v-else class="h-4 w-4" />
                        <span>Download Backup</span>
                      </button>
                  </div>
              </Card>
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
                      class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 active:scale-95 transition-all"
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

      <PromptDialog
        v-model="showPromptAddProperty"
        title="Add Custom Property"
        :message="`Enter a custom property name for [${activePromptSection}]:`"
        placeholder="e.g. custom_key"
        @confirm="handleAddProperty"
      />
  </Layout>
</template>
