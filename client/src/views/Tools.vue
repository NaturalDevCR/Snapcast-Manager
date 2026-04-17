<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchApi } from '../utils/api';
import { useUIStore } from '../stores/ui';
import { useSystemStore } from '../stores/system';
import Layout from '../components/Layout.vue';

const uiStore = useUIStore();
const systemStore = useSystemStore();

type Tab = 'crontab' | 'scripts' | 'mpd-config';
const activeTab = ref<Tab>('crontab');

// ─── Crontab ──────────────────────────────────────────────────────────────────
const crontabContent = ref('');
const crontabLoading = ref(false);

async function loadCrontab() {
  crontabLoading.value = true;
  try {
    const data = await fetchApi('/tools/crontab');
    crontabContent.value = data.content;
  } catch (e: any) {
    uiStore.showToast('Failed to load crontab: ' + e.message, 'error');
  } finally {
    crontabLoading.value = false;
  }
}

async function saveCrontab() {
  crontabLoading.value = true;
  try {
    await fetchApi('/tools/crontab', { method: 'POST', body: JSON.stringify({ content: crontabContent.value }) });
    uiStore.showToast('Crontab saved successfully', 'success');
  } catch (e: any) {
    uiStore.showToast('Failed to save crontab: ' + e.message, 'error');
  } finally {
    crontabLoading.value = false;
  }
}

// ─── MPD Config ───────────────────────────────────────────────────────────────
const mpdConfigContent = ref('');
const mpdConfigLoading = ref(false);

async function loadMpdConfig() {
  mpdConfigLoading.value = true;
  try {
    const data = await fetchApi('/tools/mpd-config');
    mpdConfigContent.value = data.content;
  } catch (e: any) {
    uiStore.showToast('Failed to load MPD config: ' + e.message, 'error');
  } finally {
    mpdConfigLoading.value = false;
  }
}

async function saveMpdConfig() {
  mpdConfigLoading.value = true;
  try {
    await fetchApi('/tools/mpd-config', { method: 'POST', body: JSON.stringify({ content: mpdConfigContent.value }) });
    uiStore.showToast('MPD config saved. Restart MPD to apply changes.', 'success');
  } catch (e: any) {
    uiStore.showToast('Failed to save MPD config: ' + e.message, 'error');
  } finally {
    mpdConfigLoading.value = false;
  }
}

// ─── Scripts ──────────────────────────────────────────────────────────────────
interface ScriptPath { id: string; label: string; path: string; }

const scriptPaths = ref<ScriptPath[]>([]);
const selectedScript = ref<ScriptPath | null>(null);
const scriptContent = ref('');
const scriptLoading = ref(false);
const newScriptLabel = ref('');
const newScriptPath = ref('');
const showAddForm = ref(false);

async function loadScriptPaths() {
  try {
    const data = await fetchApi('/tools/scripts');
    scriptPaths.value = data;
  } catch (e: any) {
    uiStore.showToast('Failed to load scripts: ' + e.message, 'error');
  }
}

async function addScriptPath() {
  if (!newScriptLabel.value.trim() || !newScriptPath.value.trim()) {
    uiStore.showToast('Label and path are required', 'error');
    return;
  }
  try {
    const entry = await fetchApi('/tools/scripts', {
      method: 'POST',
      body: JSON.stringify({ label: newScriptLabel.value.trim(), path: newScriptPath.value.trim() })
    });
    scriptPaths.value.push(entry);
    newScriptLabel.value = '';
    newScriptPath.value = '';
    showAddForm.value = false;
    uiStore.showToast('Script path added', 'success');
  } catch (e: any) {
    uiStore.showToast('Failed to add script: ' + e.message, 'error');
  }
}

async function removeScriptPath(id: string) {
  if (!confirm('Remove this script from the list?')) return;
  try {
    await fetchApi(`/tools/scripts/${id}`, { method: 'DELETE' });
    scriptPaths.value = scriptPaths.value.filter(s => s.id !== id);
    if (selectedScript.value?.id === id) {
      selectedScript.value = null;
      scriptContent.value = '';
    }
    uiStore.showToast('Script path removed', 'success');
  } catch (e: any) {
    uiStore.showToast('Failed to remove script: ' + e.message, 'error');
  }
}

async function selectScript(script: ScriptPath) {
  selectedScript.value = script;
  scriptLoading.value = true;
  try {
    const data = await fetchApi(`/tools/script?path=${encodeURIComponent(script.path)}`);
    scriptContent.value = data.content;
  } catch (e: any) {
    uiStore.showToast('Failed to load script: ' + e.message, 'error');
  } finally {
    scriptLoading.value = false;
  }
}

async function saveScript() {
  if (!selectedScript.value) return;
  scriptLoading.value = true;
  try {
    await fetchApi('/tools/script', {
      method: 'POST',
      body: JSON.stringify({ path: selectedScript.value.path, content: scriptContent.value })
    });
    uiStore.showToast('Script saved successfully', 'success');
  } catch (e: any) {
    uiStore.showToast('Failed to save script: ' + e.message, 'error');
  } finally {
    scriptLoading.value = false;
  }
}

function switchTab(tab: Tab) {
  activeTab.value = tab;
  if (tab === 'crontab') loadCrontab();
  if (tab === 'mpd-config') loadMpdConfig();
  if (tab === 'scripts') loadScriptPaths();
}

onMounted(() => {
  loadCrontab();
  loadScriptPaths();
});
</script>

<template>
  <Layout>
    <div class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 class="text-3xl font-black text-white tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">System Tools</h1>
          <p class="text-gray-400 font-medium mt-1">Edit crontab, scripts, and service configuration files.</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex flex-wrap gap-2">
        <button @click="switchTab('crontab')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'crontab'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-gray-500 border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">schedule</span>
          <span>Crontab</span>
        </button>
        <button @click="switchTab('scripts')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'scripts'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-gray-500 border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">code</span>
          <span>Scripts</span>
        </button>
        <button v-if="systemStore.installedPackages['mpd']" @click="switchTab('mpd-config')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'mpd-config'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-gray-500 border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">queue_music</span>
          <span>MPD Config</span>
        </button>
      </div>

      <!-- ─── Crontab Editor ───────────────────────────────────────────── -->
      <div v-if="activeTab === 'crontab'" class="space-y-4">
        <div class="bg-black/40 border border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
          <div class="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">schedule</span>
              <span class="text-sm font-black text-white uppercase tracking-widest">Crontab Editor</span>
            </div>
            <div class="flex items-center gap-3">
              <button @click="loadCrontab" :disabled="crontabLoading"
                class="inline-flex items-center px-3 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1" :class="{'animate-spin': crontabLoading}">sync</span>
                Reload
              </button>
              <button @click="saveCrontab" :disabled="crontabLoading"
                class="inline-flex items-center px-4 py-1.5 text-xs font-black bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl transition-all active:scale-95 uppercase tracking-widest border border-brand-primary/50 disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1">save</span>
                Save
              </button>
            </div>
          </div>
          <div class="p-4">
            <p class="text-[10px] font-mono text-gray-500 mb-3 leading-relaxed">
              Format: <span class="text-gray-400">min hour day month weekday command</span>&nbsp;&nbsp;
              Example: <span class="text-gray-400">*/5 * * * * /path/to/script.sh</span>
            </p>
            <textarea
              v-model="crontabContent"
              rows="18"
              spellcheck="false"
              class="w-full bg-black/60 border border-white/5 rounded-xl text-sm font-mono text-gray-200 p-4 focus:outline-none focus:border-brand-primary/50 resize-none leading-relaxed"
              placeholder="# No crontab entries yet&#10;# min hour day month weekday command"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- ─── Script Editor ───────────────────────────────────────────── -->
      <div v-if="activeTab === 'scripts'" class="space-y-4">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">

          <!-- Script List -->
          <div class="bg-black/40 border border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
            <div class="px-5 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <span class="text-sm font-black text-white uppercase tracking-widest">Scripts</span>
              <button @click="showAddForm = !showAddForm"
                class="p-1.5 bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary rounded-lg transition-all">
                <span class="material-symbols-outlined text-[1rem]">{{ showAddForm ? 'close' : 'add' }}</span>
              </button>
            </div>

            <!-- Add Form -->
            <div v-if="showAddForm" class="p-4 border-b border-white/5 bg-brand-primary/5 space-y-3">
              <input v-model="newScriptLabel" type="text" placeholder="Label (e.g. Startup)"
                class="w-full bg-black/60 border border-white/10 rounded-xl text-xs font-mono text-gray-200 px-3 py-2 focus:outline-none focus:border-brand-primary/50" />
              <input v-model="newScriptPath" type="text" placeholder="/path/to/script.sh"
                class="w-full bg-black/60 border border-white/10 rounded-xl text-xs font-mono text-gray-200 px-3 py-2 focus:outline-none focus:border-brand-primary/50" />
              <button @click="addScriptPath"
                class="w-full px-3 py-2 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 border border-brand-primary/50">
                Add Script
              </button>
            </div>

            <!-- Script Items -->
            <div class="divide-y divide-white/5">
              <div v-if="scriptPaths.length === 0" class="px-5 py-8 text-center text-gray-600 text-xs font-bold uppercase tracking-widest">
                No scripts added yet
              </div>
              <div v-for="script in scriptPaths" :key="script.id"
                @click="selectScript(script)"
                :class="['flex items-center justify-between px-5 py-3.5 cursor-pointer transition-all group',
                  selectedScript?.id === script.id ? 'bg-brand-primary/10 border-l-2 border-brand-primary' : 'hover:bg-white/5']">
                <div class="min-w-0 mr-2">
                  <p class="text-xs font-black text-white truncate">{{ script.label }}</p>
                  <p class="text-[10px] font-mono text-gray-500 truncate mt-0.5">{{ script.path }}</p>
                </div>
                <button @click.stop="removeScriptPath(script.id)"
                  class="opacity-0 group-hover:opacity-100 p-1 text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-all flex-shrink-0">
                  <span class="material-symbols-outlined text-[0.9rem]">delete</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Script Editor Panel -->
          <div class="lg:col-span-2 bg-black/40 border border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
            <div class="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">code</span>
                <span class="text-sm font-black text-white uppercase tracking-widest">
                  {{ selectedScript ? selectedScript.label : 'Select a script' }}
                </span>
                <span v-if="selectedScript" class="text-[10px] font-mono text-gray-500 truncate max-w-[200px]">{{ selectedScript.path }}</span>
              </div>
              <button v-if="selectedScript" @click="saveScript" :disabled="scriptLoading"
                class="inline-flex items-center px-4 py-1.5 text-xs font-black bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl transition-all active:scale-95 uppercase tracking-widest border border-brand-primary/50 disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1">save</span>
                Save
              </button>
            </div>
            <div class="p-4">
              <div v-if="!selectedScript" class="flex flex-col items-center justify-center py-20 text-gray-600">
                <span class="material-symbols-outlined text-4xl mb-3">code_off</span>
                <p class="text-xs font-black uppercase tracking-widest">Select a script from the list</p>
              </div>
              <div v-else-if="scriptLoading" class="flex items-center justify-center py-20 text-gray-500">
                <span class="material-symbols-outlined animate-spin mr-2">sync</span>
                <span class="text-xs font-black uppercase tracking-widest">Loading...</span>
              </div>
              <textarea
                v-else
                v-model="scriptContent"
                rows="22"
                spellcheck="false"
                class="w-full bg-black/60 border border-white/5 rounded-xl text-sm font-mono text-gray-200 p-4 focus:outline-none focus:border-brand-primary/50 resize-none leading-relaxed"
                placeholder="#!/bin/bash&#10;# Script content..."
              ></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── MPD Config Editor ───────────────────────────────────────── -->
      <div v-if="activeTab === 'mpd-config'" class="space-y-4">
        <div class="bg-black/40 border border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
          <div class="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">queue_music</span>
              <span class="text-sm font-black text-white uppercase tracking-widest">MPD Config</span>
              <span class="text-[10px] font-mono text-gray-500">/etc/mpd.conf</span>
            </div>
            <div class="flex items-center gap-3">
              <button @click="loadMpdConfig" :disabled="mpdConfigLoading"
                class="inline-flex items-center px-3 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1" :class="{'animate-spin': mpdConfigLoading}">sync</span>
                Reload
              </button>
              <button @click="saveMpdConfig" :disabled="mpdConfigLoading"
                class="inline-flex items-center px-4 py-1.5 text-xs font-black bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl transition-all active:scale-95 uppercase tracking-widest border border-brand-primary/50 disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1">save</span>
                Save
              </button>
            </div>
          </div>
          <div class="p-4">
            <div class="flex items-center gap-2 mb-3 p-3 bg-[#ffcc00]/5 border border-[#ffcc00]/20 rounded-xl">
              <span class="material-symbols-outlined text-[#ffcc00] text-[1rem]">info</span>
              <p class="text-[10px] font-bold text-[#ffcc00] uppercase tracking-wide">
                Restart MPD after saving to apply changes.
              </p>
              <button @click="systemStore.controlService('restart', 'mpd')" :disabled="systemStore.loading"
                class="ml-auto px-3 py-1 bg-[#ffcc00]/10 hover:bg-[#ffcc00]/20 text-[#ffcc00] border border-[#ffcc00]/20 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50">
                Restart MPD
              </button>
            </div>
            <textarea
              v-model="mpdConfigContent"
              rows="28"
              spellcheck="false"
              class="w-full bg-black/60 border border-white/5 rounded-xl text-sm font-mono text-gray-200 p-4 focus:outline-none focus:border-brand-primary/50 resize-none leading-relaxed"
              placeholder="# /etc/mpd.conf&#10;# MPD configuration file"
            ></textarea>
          </div>
        </div>
      </div>

    </div>
  </Layout>
</template>
