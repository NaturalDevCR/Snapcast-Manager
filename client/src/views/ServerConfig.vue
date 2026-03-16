<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { basicEditor } from 'prism-code-editor/setups';
import 'prism-code-editor/prism/languages/ini';
import 'prism-code-editor/layout.css';
import 'prism-code-editor/themes/dracula.css';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PromptDialog from '../components/PromptDialog.vue';



const configStore = useConfigStore();
const systemStore = useSystemStore();
const uiStore = useUIStore();



const snapshotStore = useSnapshotStore();

const activeTab = ref<'standard' | 'expert' | 'snapshots' | 'security'>('standard');
const activeSection = ref('server');
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
const showConfirmRestore = ref(false);
const showConfirmDeleteSnapshot = ref(false);
const showConfirmReset = ref(false);
const showPromptAddProperty = ref(false);
const showAddSourceDialog = ref(false);

const isEditingSource = ref(false);
const editingSourceIdx = ref<number | null>(null);

const openEditSourceDialog = (idx: number) => {
  isEditingSource.value = true;
  editingSourceIdx.value = idx;
  
  const sources = localParsedConfig.value.stream?.source;
  const uri = Array.isArray(sources) ? sources[idx] : sources;
  if (!uri) return;
  
  const typeMap: Record<string, string> = {
    'pipe://': 'pipe',
    'librespot://': 'spotify',
    'airplay://': 'airplay',
    'file://': 'file',
    'tcp://': 'tcp',
    'alsa://': 'alsa',
    'meta://': 'meta',
    'jack://': 'jack'
  };
  
  let detectedType = '';
  for (const [key, val] of Object.entries(typeMap)) {
      if (uri.startsWith(key)) {
          detectedType = val;
          break;
      }
  }
  if (uri.startsWith('process://')) {
      detectedType = uri.includes('ffmpeg') ? 'ffmpeg_radio' : 'process';
  }
  if (!detectedType) detectedType = 'pipe';
  
  selectSourceType(detectedType);
  
  const prefix = detectedType === 'ffmpeg_radio' || detectedType === 'process' ? 'process://' : `${detectedType}://`;
  const withoutPrefix = uri.substring(prefix.length);
  const qIdx = withoutPrefix.indexOf('?');
  const path = qIdx === -1 ? withoutPrefix : withoutPrefix.substring(0, qIdx);
  const query = qIdx === -1 ? '' : withoutPrefix.substring(qIdx + 1);
  
  sourceFormPath.value = path;
  const params = new URLSearchParams(query);
  sourceFormParams.value = {};
  
  for (const [key, val] of params.entries()) {
      sourceFormParams.value[key] = val;
  }
  
  if (detectedType === 'ffmpeg_radio') {
       const ffmpegParams = params.get('params') || '';
       const decoded = decodeURIComponent(ffmpegParams);
       const streamUrlMatch = decoded.match(/-i\s+([^\s]+)/);
       if (streamUrlMatch && streamUrlMatch[1]) {
           sourceFormParams.value['_stream_url'] = streamUrlMatch[1];
       }
  }
  
  showAddSourceDialog.value = true;
};

const pendingRestoreId = ref<number | null>(null);
const pendingDeleteSnapshotId = ref<number | null>(null);
const activePromptSection = ref('');

// Source creation state
const selectedSourceType = ref('');
const sourceFormPath = ref('');
const sourceFormParams = ref<Record<string, string>>({});

const sectionIcons: Record<string, string> = {
  server: 'router',
  ssl: 'lock',
  http: 'language',
  'tcp-control': 'terminal',
  'tcp-streaming': 'sensors',
  stream: 'queue_music',
  streaming_client: 'cast',
  logging: 'article',
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

watch(activeTab, async (newTab) => {
    if (newTab === 'expert') {
        await nextTick();
        if (editorRef.value && !editorInstance) {
            editorInstance = basicEditor(
                editorRef.value,
                {
                    language: 'ini',
                    theme: 'dracula',
                    value: localRawConfig.value
                },
                () => {
                    editorInstance.addListener('update', (value: string) => {
                        localRawConfig.value = value;
                    });
                }
            );
        } else if (editorInstance) {
            editorInstance.setOptions({ value: localRawConfig.value });
        }
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
  isEditingSource.value = false;
  editingSourceIdx.value = null;
  selectedSourceType.value = '';
  sourceFormPath.value = '';
  sourceFormParams.value = {};
  showAddSourceDialog.value = true;
};

const selectSourceType = (type: string) => {
  selectedSourceType.value = type;
  const template = sourceTemplates.value.find((t: any) => t.type === type);
  if (template) {
    if (!isEditingSource.value) {
      sourceFormPath.value = template.pathPlaceholder;
      sourceFormParams.value = {};
      for (const p of template.params) {
        sourceFormParams.value[p.key] = p.default || '';
      }
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
    const streamUrl = sourceFormParams.value['_stream_url'] || '';
    const name = sourceFormParams.value['name'] || 'Radio';
    const sampleformat = sourceFormParams.value['sampleformat'] || '48000:16:2';
    const [rate, , channels] = sampleformat.split(':');
    const ffmpegArgs = `-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i ${streamUrl} -f s16le -ar ${rate || '48000'} -ac ${channels || '2'} -`;
    const encodedParams = ffmpegArgs.replace(/ /g, '%20');
    
    params.push(`name=${name}`);
    for (const p of template.params) {
      if (p.key === '_stream_url' || p.key === 'name') continue;
      const val = sourceFormParams.value[p.key];
      if (val !== undefined && val !== '' && val !== p.default) {
        params.push(`${p.key}=${val}`);
      }
    }
    params.push(`params=${encodedParams}`);
  } else {
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
  
  if (isEditingSource.value && editingSourceIdx.value !== null) {
      const current = localParsedConfig.value.stream.source;
      if (Array.isArray(current)) {
          current[editingSourceIdx.value] = uri;
      } else {
          localParsedConfig.value.stream.source = uri;
      }
      uiStore.showToast('Source updated! Save to apply.', 'success');
  } else {
      const current = localParsedConfig.value.stream.source;
      if (Array.isArray(current)) {
        current.push(uri);
      } else if (current) {
        localParsedConfig.value.stream.source = [current, uri];
      } else {
        localParsedConfig.value.stream.source = uri;
      }
      uiStore.showToast('Source added! Save to apply.', 'success');
  }
  
  if (!enabledProperties.value.stream) enabledProperties.value.stream = {};
  enabledProperties.value.stream.source = true;
  
  showAddSourceDialog.value = false;
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
      <div class="mb-8 flex overflow-x-auto flex-nowrap space-x-2 bg-black/40 backdrop-blur-md p-1.5 rounded-2xl w-fit max-w-full border border-white/5 shadow-lg">
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
              <span>Standard</span>
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
              <span>Expert</span>
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
              <span>Snapshots</span>
          </button>
          <button 
            @click="activeTab = 'security'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm tracking-widest uppercase',
                activeTab === 'security' 
                ? 'bg-brand-primary text-white shadow-[0_0_15px_rgba(166,13,242,0.4)]' 
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            ]"
          >
              <span class="material-symbols-outlined text-[18px]">security</span>
              <span>Security</span>
          </button>
      </div>

      <!-- ==================== STANDARD TAB ==================== -->
      <div v-if="activeTab === 'standard'" class="animate-in fade-in slide-in-from-left-4 duration-500">
          
          <!-- Section Sub-Tabs -->
          <div class="mb-6 flex overflow-x-auto flex-nowrap gap-2 max-w-full">
              <button
                v-for="sKey in orderedSections"
                :key="sKey"
                @click="activeSection = sKey"
                :class="[
                    'flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap border',
                    activeSection === sKey
                    ? 'bg-brand-primary text-white border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)]'
                    : 'bg-black/20 text-gray-400 border-white/5 hover:bg-white/5 hover:text-white'
                ]"
              >
                  <span class="material-symbols-outlined text-[14px]">{{ sectionIcons[sKey] || 'tune' }}</span>
                  <span>{{ configSections[sKey]?.label || sKey }}</span>
              </button>
          </div>

          <!-- Section Content -->
          <Card>
              <template #title>
                  <div class="flex items-center space-x-3">
                    <span class="material-symbols-outlined text-[20px] text-brand-primary drop-shadow-[0_0_8px_rgba(166,13,242,0.5)]">{{ sectionIcons[activeSection] || 'tune' }}</span>
                    <div>
                      <span class="text-sm font-black text-white uppercase tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">{{ currentSectionMeta.label }}</span>
                      <p class="text-[10px] font-semibold text-gray-500 mt-0.5">{{ currentSectionMeta.description }}</p>
                    </div>
                  </div>
              </template>
              <template #action>
                  <div v-if="activeSection !== 'stream'" class="flex items-center space-x-2">
                      <button @click="triggerAddProperty(activeSection)" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-brand-primary hover:text-white hover:bg-brand-primary border border-brand-primary/30 rounded-lg transition-all uppercase tracking-widest shadow-[inset_0_0_10px_rgba(166,13,242,0.1)] hover:shadow-[0_0_15px_rgba(166,13,242,0.5)]" title="Add custom property">
                        <span class="material-symbols-outlined text-[14px] mr-1">add</span>
                        Custom
                      </button>
                  </div>
              </template>
              
              <div v-if="activeSection === 'stream'">
                  <!-- ==== SUB-SECTION 1: Audio Sources ==== -->
                  <div class="mb-4">
                    <div class="flex items-center justify-between mb-4">
                      <div class="flex items-center space-x-2">
                        <span class="material-symbols-outlined text-[18px] text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">queue_music</span>
                        <h3 class="text-[11px] font-black text-white uppercase tracking-widest">Audio Sources</h3>
                        <span v-if="availableSourceNames.length" class="px-2 py-0.5 bg-[#00ff9d]/10 text-[#00ff9d] border border-[#00ff9d]/20 text-[10px] font-black rounded-full">{{ availableSourceNames.length }}</span>
                      </div>
                      <button @click="openAddSourceDialog" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-[#00ff9d] hover:bg-[#00ff9d]/10 hover:text-white rounded-lg transition-all uppercase tracking-widest border border-[#00ff9d]/30 shadow-[inset_0_0_10px_rgba(0,255,157,0.1)] hover:shadow-[0_0_15px_rgba(0,255,157,0.3)]">
                        <span class="material-symbols-outlined text-[14px] mr-1">add</span>
                        Add Source
                      </button>
                    </div>
                    
                    <div v-if="!localParsedConfig.stream?.source" class="text-center py-8 border border-dashed border-white/10 rounded-xl bg-black/20">
                      <span class="material-symbols-outlined text-[32px] text-gray-500 mx-auto mb-2 drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">library_music</span>
                      <p class="text-xs font-black text-gray-400 uppercase tracking-widest">No sources configured</p>
                      <p class="text-[10px] text-gray-500 mt-1">Use "Add Source" to create your first audio stream</p>
                    </div>
                    
                    <div v-else class="space-y-3">
                      <div v-for="(_item, idx) in (Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source : [localParsedConfig.stream.source])" :key="idx"
                        class="rounded-xl border border-white/5 bg-black/30 overflow-hidden shadow-sm hover:border-brand-primary/30 transition-colors">
                        <!-- Source header with name badge -->
                        <div class="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5">
                          <div class="flex items-center space-x-2">
                            <span class="px-2 py-0.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-[10px] font-black uppercase tracking-widest rounded-md">
                              {{ getSourceType(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) }}
                            </span>
                            <span class="text-sm font-bold text-gray-200">
                              {{ extractSourceName(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) || 'Unnamed' }}
                            </span>
                          </div>
                          <div class="flex items-center space-x-1">
                            <button @click="openEditSourceDialog(idx as number)" class="p-1.5 text-gray-400 hover:text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors border border-transparent hover:border-brand-primary/20" title="Edit source">
                              <span class="material-symbols-outlined text-[16px]">edit</span>
                            </button>
                            <button v-if="Array.isArray(localParsedConfig.stream.source)" @click="removeSourceEntry(idx as number)" class="p-1.5 text-gray-400 hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-colors border border-transparent hover:border-[#ff3b30]/20" title="Remove source">
                              <span class="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </div>
                        <!-- Source URI input -->
                        <div class="px-3 py-3">
                          <input 
                            v-if="Array.isArray(localParsedConfig.stream.source)"
                            v-model="localParsedConfig.stream.source[idx]"
                            class="w-full text-xs font-mono font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                          />
                          <input 
                            v-else
                            :value="localParsedConfig.stream.source"
                            @input="setPropertyValue('stream', 'source', ($event.target as HTMLInputElement).value)"
                            class="w-full text-xs font-mono font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- ==== DIVIDER ==== -->
                  <div class="border-t border-white/5 my-8"></div>

                  <!-- ==== SUB-SECTION 2: Stream Settings ==== -->
                  <div>
                    <div class="flex items-center justify-between mb-4">
                      <div class="flex items-center space-x-2">
                        <span class="material-symbols-outlined text-[18px] text-[#00d4ff] drop-shadow-[0_0_5px_rgba(0,212,255,0.5)]">tune</span>
                        <h3 class="text-[11px] font-black text-white uppercase tracking-widest">Stream Settings</h3>
                      </div>
                      <button @click="triggerAddProperty('stream')" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-[#00d4ff] hover:text-white hover:bg-[#00d4ff]/10 border border-[#00d4ff]/30 rounded-lg transition-all uppercase tracking-widest shadow-[inset_0_0_10px_rgba(0,212,255,0.1)] hover:shadow-[0_0_15px_rgba(0,212,255,0.3)]" title="Add custom property">
                        <span class="material-symbols-outlined text-[14px] mr-1">add</span>
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
                  <div v-if="allPropertyKeys.length === 0" class="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
                      <p class="text-xs font-black text-gray-500 uppercase tracking-widest">No properties available for this section</p>
                  </div>
                  
                  <div v-for="key in allPropertyKeys" :key="key" 
                    :class="[
                      'grid grid-cols-1 md:grid-cols-12 gap-3 items-start py-3 px-4 rounded-xl transition-all -mx-4',
                      isPropertyEnabled(activeSection, key)
                        ? 'hover:bg-white/5'
                        : 'opacity-40 hover:opacity-60'
                    ]">
                      
                      <!-- Enable/Disable Toggle (col 1) -->
                      <div class="md:col-span-1 flex items-center pt-1">
                        <button 
                          @click="toggleProperty(activeSection, key)"
                          :class="[
                            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                            isPropertyEnabled(activeSection, key) ? 'bg-brand-primary' : 'bg-gray-700'
                          ]"
                          :title="isPropertyEnabled(activeSection, key) ? 'Disable this property' : 'Enable this property'"
                        >
                          <span :class="[isPropertyEnabled(activeSection, key) ? 'translate-x-4' : 'translate-x-0', 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                        </button>
                      </div>

                      <!-- Label Column (col 2-4) -->
                      <div class="md:col-span-3">
                          <div class="flex flex-col min-w-0">
                            <label class="text-[11px] font-black text-gray-300 uppercase tracking-wide">
                              {{ getMetaForKey(activeSection, key)?.label || key }}
                            </label>
                            <span v-if="getMetaForKey(activeSection, key)?.description" 
                              class="text-[10px] text-gray-500 leading-snug mt-0.5">
                              {{ getMetaForKey(activeSection, key)?.description }}
                            </span>
                            <span v-if="getMetaForKey(activeSection, key)?.default !== undefined" 
                              class="text-[9px] text-[#00d4ff]/70 mt-0.5 font-mono">
                              default: {{ getMetaForKey(activeSection, key)?.default }}
                            </span>
                          </div>
                      </div>
                      
                      <!-- Input Column (col 5-12) -->
                      <div class="md:col-span-8">
                          <!-- DISABLED property: show default as read-only -->
                          <div v-if="!isPropertyEnabled(activeSection, key)" class="py-1">
                            <span class="text-xs text-gray-500 font-mono">
                              {{ getMetaForKey(activeSection, key)?.default ?? '(empty)' }}
                            </span>
                          </div>

                          <!-- Boolean Toggle -->
                          <div v-else-if="getMetaForKey(activeSection, key)?.type === 'boolean'" class="flex items-center py-1">
                            <button 
                              @click="setPropertyValue(activeSection, key, String(getPropertyValue(activeSection, key)) === 'true' ? 'false' : 'true')"
                              :class="[
                                'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-black',
                                String(getPropertyValue(activeSection, key)) === 'true' ? 'bg-brand-primary' : 'bg-gray-700'
                              ]"
                            >
                              <span :class="[String(getPropertyValue(activeSection, key)) === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                            </button>
                            <span class="ml-3 text-xs text-gray-400 font-bold uppercase tracking-widest">
                              {{ String(getPropertyValue(activeSection, key)) === 'true' ? 'Enabled' : 'Disabled' }}
                            </span>
                          </div>
                          
                          <!-- Select Dropdown -->
                          <div v-else-if="getMetaForKey(activeSection, key)?.type === 'select'" class="relative">
                            <select
                              :value="getPropertyValue(activeSection, key)"
                              @change="setPropertyValue(activeSection, key, ($event.target as HTMLSelectElement).value)"
                              class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 appearance-none pr-10"
                            >
                              <option v-for="opt in getMetaForKey(activeSection, key)?.options" :key="opt" :value="opt" class="bg-black text-white">
                                {{ opt || '(auto)' }}
                              </option>
                            </select>
                            <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none text-[18px]">expand_more</span>
                          </div>

                          <!-- Number Input -->
                          <input 
                            v-else-if="getMetaForKey(activeSection, key)?.type === 'number'"
                            type="number"
                            :value="getPropertyValue(activeSection, key)"
                            @input="setPropertyValue(activeSection, key, ($event.target as HTMLInputElement).value)"
                            :placeholder="String(getMetaForKey(activeSection, key)?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 placeholder-gray-600"
                          />
                          
                          <!-- Default Text Input -->
                          <input 
                            v-else
                            :value="getPropertyValue(activeSection, key)"
                            @input="setPropertyValue(activeSection, key, ($event.target as HTMLInputElement).value)"
                            :placeholder="String(getMetaForKey(activeSection, key)?.default ?? '')"
                            class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 placeholder-gray-600"
                          />
                      </div>
                  </div>
              </div>
          </Card>

          <!-- Bottom Actions -->
          <div class="mt-8 mb-24 flex justify-center">
              <button @click="showConfirmReset = true" class="py-3 px-6 border border-white/5 rounded-xl text-gray-500 hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 hover:border-[#ff3b30]/20 transition-all flex items-center space-x-2">
                  <span class="material-symbols-outlined text-[16px]">restart_alt</span>
                  <span class="text-[10px] font-black uppercase tracking-widest">Reset Configuration to Default</span>
              </button>
          </div>

          <div class="mt-6 flex justify-center fixed bottom-8 left-1/2 -translate-x-1/2 z-30">
              <button 
                  @click="saveParsed" 
                  :disabled="configStore.loading"
                  class="flex items-center space-x-2 px-8 py-4 rounded-2xl shadow-[0_0_20px_rgba(166,13,242,0.6)] text-sm font-black text-white bg-brand-primary hover:bg-[#b526ff] hover:-translate-y-1 active:scale-95 disabled:opacity-50 transition-all duration-300"
              >
                  <span v-if="configStore.loading" class="material-symbols-outlined text-[20px] animate-spin">sync</span>
                  <span>SAVE CONFIGURATION</span>
              </button>
          </div>
      </div>

      <!-- ==================== EXPERT TAB ==================== -->
      <div v-else-if="activeTab === 'expert'" class="animate-in fade-in slide-in-from-right-4 duration-500 space-y-6">
          <!-- Page Header -->
          <div class="flex items-center justify-between">
              <div>
                  <h2 class="text-xl font-black text-white uppercase tracking-wider drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">Raw Editor</h2>
                  <p class="text-[11px] font-bold text-gray-500 uppercase tracking-widest mt-1">
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
              <div class="bg-black/30 px-6 py-2.5 flex items-center justify-between text-[10px] font-mono text-gray-500 border-b border-white/5">
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
              <div ref="editorRef" class="h-[600px] text-xs font-mono pce-custom"></div>
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
                  <button 
                      @click="saveRaw" 
                      :disabled="configStore.loading"
                      class="w-full sm:w-auto flex items-center justify-center space-x-2 py-3.5 px-6 rounded-xl bg-brand-primary hover:bg-[#b526ff] text-white font-black text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(166,13,242,0.4)] hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] disabled:opacity-50 transition-all border border-brand-primary/30 active:scale-95"
                  >
                      <span v-if="configStore.loading" class="material-symbols-outlined text-[16px] animate-spin">sync</span>
                      <span v-else class="material-symbols-outlined text-[16px]">save</span>
                      <span>Apply Raw Changes</span>
                  </button>
              </div>
          </div>

      </div>

      <!-- ==================== SNAPSHOTS TAB ==================== -->
      <div v-else-if="activeTab === 'snapshots'" class="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div class="lg:col-span-1">
                  <Card title="Checkpoint">
                      <template #icon>
                        <span class="material-symbols-outlined text-[20px] text-brand-primary drop-shadow-[0_0_8px_rgba(166,13,242,0.5)]">content_copy</span>
                      </template>
                      <div class="space-y-5">
                          <div>
                              <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Identifier</label>
                              <input v-model="snapshotName" type="text" placeholder="e.g. Pre-optimization" 
                                class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600">
                          </div>
                          <div>
                              <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Notes</label>
                              <textarea v-model="snapshotDescription" placeholder="Briefly describe why this checkpoint is being made..." 
                                class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600 h-32 resize-none"></textarea>
                          </div>
                          <button 
                            @click="handleCreateSnapshot"
                            :disabled="snapshotStore.loading || !snapshotName"
                            class="w-full px-6 py-3 bg-brand-primary text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#b526ff] shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_20px_rgba(166,13,242,0.6)] disabled:opacity-50 transition-all active:scale-95 border border-brand-primary"
                          >
                            Capture State
                          </button>
                      </div>
                  </Card>
              </div>
              <div class="lg:col-span-2">
                  <Card title="Version History">
                      <template #icon>
                        <span class="material-symbols-outlined text-[20px] text-[#00d4ff] drop-shadow-[0_0_5px_rgba(0,212,255,0.5)]">history</span>
                      </template>
                      <div v-if="snapshotStore.loading && snapshotStore.snapshots.length === 0" class="flex justify-center py-12">
                          <span class="material-symbols-outlined text-[32px] text-brand-primary animate-spin">sync</span>
                      </div>
                      <div v-else-if="snapshotStore.snapshots.length === 0" class="text-center py-24 bg-black/20 rounded-2xl border border-dashed border-white/10">
                          <p class="text-xs font-black text-gray-500 uppercase tracking-[0.2em]">No snapshots archived</p>
                      </div>
                      <div v-else class="space-y-4">
                          <div v-for="snapshot in snapshotStore.snapshots" :key="snapshot.id" 
                            class="p-5 border border-white/5 rounded-2xl flex justify-between items-center bg-black/30 hover:bg-black/50 hover:border-brand-primary/30 transition-all group shadow-sm">
                              <div class="space-y-1">
                                  <h4 class="font-black text-white uppercase tracking-tight drop-shadow-[0_0_5px_rgba(255,255,255,0.2)]">{{ snapshot.name }}</h4>
                                  <p v-if="snapshot.description" class="text-xs font-semibold text-gray-400">{{ snapshot.description }}</p>
                                  <div class="flex items-center text-[10px] font-bold text-brand-primary bg-brand-primary/10 border border-brand-primary/20 px-2 py-0.5 rounded w-fit mt-2 uppercase tracking-widest">
                                    {{ new Date(snapshot.timestamp).toLocaleString() }}
                                  </div>
                              </div>
                              <div class="flex space-x-2">
                                  <button @click="triggerRestoreSnapshot(snapshot.id)" 
                                    class="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-lg hover:bg-brand-primary hover:text-white transition-all shadow-[inset_0_0_10px_rgba(166,13,242,0.1)] hover:shadow-[0_0_15px_rgba(166,13,242,0.3)] active:scale-95">
                                      Restore
                                  </button>
                                  <button @click="triggerDeleteSnapshot(snapshot.id)"
                                    class="p-2 text-gray-500 hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 border border-transparent hover:border-[#ff3b30]/20 rounded-lg transition-all group-hover:opacity-100 md:opacity-0 active:scale-95">
                                      <span class="material-symbols-outlined text-[18px]">delete</span>
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
                    <span class="material-symbols-outlined text-[20px] text-[#ff2a5f] drop-shadow-[0_0_5px_rgba(255,42,95,0.5)]">lock</span>
                  </template>
                  <div class="space-y-5">
                      <div>
                          <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Current Password</label>
                          <input v-model="currentPassword" type="password" placeholder="Enter current password" 
                            class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-[#ff2a5f]/30 focus:border-[#ff2a5f] outline-none transition-all text-gray-300 placeholder-gray-600">
                      </div>
                      <div>
                          <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">New Password</label>
                          <input v-model="newPassword" type="password" placeholder="Enter new password" 
                            class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-[#ff2a5f]/30 focus:border-[#ff2a5f] outline-none transition-all text-gray-300 placeholder-gray-600">
                      </div>
                      <div>
                          <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Confirm New Password</label>
                          <input v-model="confirmPassword" type="password" placeholder="Re-enter new password" 
                            class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-[#ff2a5f]/30 focus:border-[#ff2a5f] outline-none transition-all text-gray-300 placeholder-gray-600">
                      </div>
                      <button 
                        @click="handleChangePassword"
                        :disabled="isSavingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword"
                        class="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-[#ff2a5f] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#ff154d] border border-[#ff2a5f] shadow-[0_0_15px_rgba(255,42,95,0.4)] hover:shadow-[0_0_20px_rgba(255,42,95,0.6)] disabled:opacity-50 transition-all active:scale-95"
                      >
                        <span v-if="isSavingPassword" class="material-symbols-outlined text-[16px] animate-spin">sync</span>
                        <span>Update Password</span>
                      </button>
                  </div>
              </Card>

              <!-- Export Backup -->
              <Card title="Export Server Backup">
                  <template #icon>
                    <span class="material-symbols-outlined text-[20px] text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">download</span>
                  </template>
                  <div class="space-y-5">
                      <p class="text-sm font-medium text-gray-400 leading-relaxed">
                          Download a complete backup of your Snapcast Manager configuration. 
                          This <span class="text-[#00ff9d] font-bold drop-shadow-[0_0_5px_rgba(0,255,157,0.2)]">.tar.gz</span> archive includes:
                      </p>
                      <ul class="text-xs font-semibold text-gray-300 space-y-3 mb-6">
                          <li class="flex items-center"><span class="material-symbols-outlined text-[16px] mr-2 text-brand-primary">security</span> Administrator Account</li>
                          <li class="flex items-center"><span class="material-symbols-outlined text-[16px] mr-2 text-[#00d4ff]">history</span> Saved Snapshots</li>
                          <li class="flex items-center"><span class="material-symbols-outlined text-[16px] mr-2 text-[#ff2a5f]">tune</span> Snapserver Configuration</li>
                      </ul>
                      
                      <div class="bg-amber-500/5 border border-amber-500/20 p-4 rounded-xl">
                          <p class="text-[10px] font-black text-amber-500 uppercase tracking-widest">Restore Instructions</p>
                          <p class="text-xs text-amber-400/80 mt-1">Keep this file safe. When reinstalling Snapcast Manager on a new device, you can use the flag <code class="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono border border-amber-500/10">--restore /path/to/backup.tar.gz</code> during setup to restore everything magically.</p>
                      </div>

                      <button 
                        @click="handleExportBackup"
                        :disabled="isExporting"
                        class="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-[#00ff9d]/10 text-[#00ff9d] border border-[#00ff9d]/30 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#00ff9d] hover:text-black shadow-[0_0_15px_rgba(0,255,157,0.2)] hover:shadow-[0_0_20px_rgba(0,255,157,0.5)] disabled:opacity-50 transition-all active:scale-95 mt-4"
                      >
                        <span v-if="isExporting" class="material-symbols-outlined text-[16px] animate-spin">sync</span>
                        <span v-else class="material-symbols-outlined text-[16px]">download</span>
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
            <div class="fixed inset-0 bg-black/80 backdrop-blur-md" @click="showAddSourceDialog = false"></div>
            <div class="relative bg-[#1c1022] rounded-2xl shadow-[0_0_30px_rgba(166,13,242,0.3)] border border-white/5 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
              
              <!-- Header -->
              <div class="sticky top-0 bg-[#1c1022]/90 backdrop-blur-sm border-b border-white/5 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
                <div>
                  <h3 class="text-sm font-black text-white uppercase tracking-widest drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{{ isEditingSource ? 'Edit Audio Source' : 'Add Audio Source' }}</h3>
                  <p class="text-[10px] text-gray-500 mt-0.5">{{ isEditingSource ? 'Modify the source parameters' : 'Select a source type and configure its parameters' }}</p>
                </div>
                <button @click="showAddSourceDialog = false" class="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-white/5 transition-all">
                  <span class="material-symbols-outlined text-[20px]">close</span>
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
                      class="flex flex-col items-center p-4 rounded-xl border border-white/5 bg-black/40 hover:border-brand-primary/50 hover:bg-brand-primary/10 transition-all group text-center shadow-lg"
                    >
                      <div class="p-2 bg-white/5 border border-white/5 rounded-lg group-hover:bg-brand-primary/20 group-hover:border-brand-primary/30 transition-colors mb-2 shadow-[inset_0_0_10px_rgba(255,255,255,0.05)] group-hover:shadow-[inset_0_0_15px_rgba(166,13,242,0.3)]">
                        <span class="material-symbols-outlined text-[24px] text-gray-400 group-hover:text-brand-primary transition-colors drop-shadow-[0_0_5px_currentColor]">queue_music</span>
                      </div>
                      <span class="text-xs font-black uppercase tracking-wider text-gray-200 group-hover:text-white">{{ tmpl.label }}</span>
                      <span class="text-[9px] text-gray-500 mt-1 leading-tight group-hover:text-gray-400">{{ tmpl.description.split('.')[0] }}</span>
                    </button>
                  </div>
                </div>

                <!-- Step 2: Parameter Form -->
                <div v-else-if="selectedTemplate">
                  <button @click="selectedSourceType = ''" class="text-[10px] font-black text-brand-primary uppercase tracking-widest mb-4 hover:text-[#b526ff] hover:drop-shadow-[0_0_5px_rgba(166,13,242,0.5)] transition-all flex items-center">
                    <span class="material-symbols-outlined text-[14px] mr-1">arrow_back</span>
                    Back to source types
                  </button>

                  <div class="mb-5 p-4 bg-brand-primary/10 border border-brand-primary/20 rounded-xl">
                    <div class="flex items-start space-x-3">
                      <span class="material-symbols-outlined text-[20px] text-brand-primary flex-shrink-0 mt-0.5">info</span>
                      <div>
                        <span class="text-xs font-black text-brand-primary uppercase tracking-widest drop-shadow-[0_0_5px_rgba(166,13,242,0.3)]">{{ selectedTemplate.label }}</span>
                        <p class="text-[10px] text-brand-primary/70 mt-1">{{ selectedTemplate.description }}</p>
                        <p v-if="selectedTemplate.fixedSampleFormat" class="text-[10px] text-amber-500/80 mt-2 font-black tracking-widest uppercase">
                          <span class="mr-1">⚠</span> Fixed sample format: {{ selectedTemplate.fixedSampleFormat }}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-4">
                    <!-- Path -->
                    <div>
                      <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">
                        Path / Host
                      </label>
                      <input
                        v-model="sourceFormPath"
                        :placeholder="selectedTemplate.pathPlaceholder"
                        class="w-full text-sm font-mono px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                      />
                    </div>

                    <!-- Parameters -->
                    <div v-for="param in selectedTemplate.params" :key="param.key">
                      <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">
                        {{ param.label }}
                        <span v-if="param.required" class="text-[#ff2a5f] ml-0.5 drop-shadow-[0_0_2px_rgba(255,42,95,0.8)]">*</span>
                      </label>
                      <span class="text-[9px] text-gray-500 block mb-2">{{ param.description }}</span>
                      
                      <!-- Boolean param -->
                      <div v-if="param.type === 'boolean'" class="flex items-center">
                        <button 
                          @click="sourceFormParams[param.key] = sourceFormParams[param.key] === 'true' ? 'false' : 'true'"
                          :class="[
                            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:ring-2 focus:ring-brand-primary focus:outline-none focus:ring-offset-2 focus:ring-offset-[#1c1022]',
                            sourceFormParams[param.key] === 'true' ? 'bg-brand-primary shadow-[0_0_10px_rgba(166,13,242,0.4)]' : 'bg-gray-700'
                          ]"
                        >
                          <span :class="[sourceFormParams[param.key] === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200']" />
                        </button>
                        <span class="ml-3 text-xs text-gray-400 font-bold uppercase tracking-widest">
                          {{ sourceFormParams[param.key] === 'true' ? 'Yes' : 'No' }}
                        </span>
                      </div>
                      
                      <!-- Select param -->
                      <div v-else-if="param.type === 'select'" class="relative">
                        <select
                          v-model="sourceFormParams[param.key]"
                          class="w-full text-sm font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 appearance-none pr-10"
                        >
                          <option v-for="opt in param.options" :key="opt" :value="opt" class="bg-black text-white">{{ opt }}</option>
                        </select>
                        <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none text-[18px]">expand_more</span>
                      </div>
                      
                      <!-- Number param -->
                      <input 
                        v-else-if="param.type === 'number'"
                        type="number"
                        v-model="sourceFormParams[param.key]"
                        :placeholder="param.default || ''"
                        class="w-full text-sm font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                      />
                      
                      <!-- Text param -->
                      <input 
                        v-else
                        v-model="sourceFormParams[param.key]"
                        :placeholder="param.placeholder || param.default || ''"
                        class="w-full text-sm font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                      />
                    </div>
                  </div>

                  <!-- URI Preview -->
                  <div class="mt-6 p-4 bg-black/50 rounded-xl border border-white/5">
                    <label class="text-[9px] font-black text-gray-500 uppercase tracking-widest block mb-2">Generated URI</label>
                    <code class="text-[11px] text-[#00d4ff] font-mono break-all leading-relaxed">{{ buildSourceUri() }}</code>
                  </div>

                  <!-- Actions -->
                  <div class="flex justify-end space-x-3 mt-6">
                    <button @click="showAddSourceDialog = false" class="px-5 py-2.5 text-xs font-black text-gray-500 uppercase tracking-widest hover:text-white transition-colors">
                      Cancel
                    </button>
                    <button 
                      @click="addSourceFromTemplate"
                      class="px-6 py-2.5 bg-brand-primary text-white border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_20px_rgba(166,13,242,0.6)] rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#b526ff] active:scale-95 transition-all"
                    >
                      {{ isEditingSource ? 'Update Source' : 'Add Source' }}
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

<style scoped>
.pce-custom.prism-code-editor {
  --pce-bg: transparent !important; 
  --pce-cursor: #bd93f9 !important;
  --pce-selection: rgba(139, 92, 246, 0.2) !important;
  --pce-line-number: #4a3856 !important;
  --pce-widget-bg: #1a1024 !important;
  background: transparent !important;
  background-color: transparent !important;
}

/* Ensure padding and layout look clean */
.pce-custom.prism-code-editor :deep(.pce-textarea),
.pce-custom.prism-code-editor :deep(.pce-code) {
  padding: 1.5rem !important;
  line-height: 1.6 !important;
  background: transparent !important;
}

/* Style line numbers wrapper to look like left gutter */
.pce-custom.prism-code-editor :deep(.prism-code-editor .line-numbers) {
  background: rgba(0, 0, 0, 0.1) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.02);
}

.pce-custom.prism-code-editor :deep(.active-line) {
  background: rgba(166, 13, 242, 0.04);
}
</style>
