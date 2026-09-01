<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchApi } from '../utils/api';
import { useUIStore } from '../stores/ui';
import { useSystemStore } from '../stores/system';
import Layout from '../components/Layout.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ConfirmDestructive from '../components/ui/ConfirmDestructive.vue';

const { t } = useI18n({ useScope: 'global' });
const uiStore = useUIStore();
const systemStore = useSystemStore();

type Tab = 'crontab' | 'scripts' | 'mpd-config' | 'backups';
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
    uiStore.showToast(t('tools.failedToLoadCrontab') + e.message, 'error');
  } finally {
    crontabLoading.value = false;
  }
}

async function saveCrontab() {
  crontabLoading.value = true;
  try {
    await fetchApi('/tools/crontab', { method: 'POST', body: JSON.stringify({ content: crontabContent.value }) });
    uiStore.showToast(t('tools.crontabSaved'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToSaveCrontab') + e.message, 'error');
  } finally {
    crontabLoading.value = false;
  }
}

// ─── MPD Config ───────────────────────────────────────────────────────────────
const mpdConfigContent = ref('');
const mpdConfigLoading = ref(false);

async function loadMpdConfig() {
  mpdConfigLoading.value = true;
  systemStore.fetchMympdInfo();
  try {
    const data = await fetchApi('/tools/mpd-config');
    mpdConfigContent.value = data.content;
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToLoadMpdConfig') + e.message, 'error');
  } finally {
    mpdConfigLoading.value = false;
  }
}

async function saveMpdConfig() {
  mpdConfigLoading.value = true;
  try {
    await fetchApi('/tools/mpd-config', { method: 'POST', body: JSON.stringify({ content: mpdConfigContent.value }) });
    uiStore.showToast(t('tools.mpdConfigSaved'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToSaveMpdConfig') + e.message, 'error');
  } finally {
    mpdConfigLoading.value = false;
  }
}

function openMympd() {
  window.open(systemStore.mympdUrl, '_blank', 'noopener');
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
    uiStore.showToast(t('tools.failedToLoadScripts') + e.message, 'error');
  }
}

async function addScriptPath() {
  if (!newScriptLabel.value.trim() || !newScriptPath.value.trim()) {
    uiStore.showToast(t('tools.labelAndPathRequired'), 'error');
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
    uiStore.showToast(t('tools.scriptPathAdded'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToAddScript') + e.message, 'error');
  }
}

// Removing a registration never deletes the underlying file (verified
// against server/src/routes/tools.ts's DELETE /scripts/:id handler) --
// disruptive but not data-destructive, so this uses the plain ConfirmDialog.
const showConfirmRemoveScript = ref(false);
const pendingRemoveScriptId = ref<string | null>(null);

function confirmRemoveScript(id: string) {
  pendingRemoveScriptId.value = id;
  showConfirmRemoveScript.value = true;
}

async function removeScriptPath() {
  const id = pendingRemoveScriptId.value;
  if (!id) return;
  try {
    await fetchApi(`/tools/scripts/${id}`, { method: 'DELETE' });
    scriptPaths.value = scriptPaths.value.filter(s => s.id !== id);
    if (selectedScript.value?.id === id) {
      selectedScript.value = null;
      scriptContent.value = '';
    }
    uiStore.showToast(t('tools.scriptPathRemoved'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToRemoveScript') + e.message, 'error');
  } finally {
    pendingRemoveScriptId.value = null;
  }
}

async function selectScript(script: ScriptPath) {
  selectedScript.value = script;
  scriptLoading.value = true;
  try {
    const data = await fetchApi(`/tools/script?path=${encodeURIComponent(script.path)}`);
    scriptContent.value = data.content;
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToLoadScript') + e.message, 'error');
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
    uiStore.showToast(t('tools.scriptSaved'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToSaveScript') + e.message, 'error');
  } finally {
    scriptLoading.value = false;
  }
}

// ─── Backups ──────────────────────────────────────────────────────────────────
interface BackupEntry { name: string; size: number; mtime: string; components: string[]; }

const backups = ref<BackupEntry[]>([]);
const backupsLoading = ref(false);

async function loadBackups() {
  backupsLoading.value = true;
  try {
    const data = await fetchApi('/system/backups');
    backups.value = data.backups;
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToLoadBackups') + e.message, 'error');
  } finally {
    backupsLoading.value = false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Overwrites the live config -- data-destructive, so this uses
// ConfirmDestructive (type the backup's name to confirm).
const showConfirmRestoreBackup = ref(false);
const pendingRestoreBackup = ref<BackupEntry | null>(null);

function confirmRestoreBackup(backup: BackupEntry) {
  pendingRestoreBackup.value = backup;
  showConfirmRestoreBackup.value = true;
}

async function restoreBackup() {
  const backup = pendingRestoreBackup.value;
  if (!backup) return;
  backupsLoading.value = true;
  try {
    await fetchApi('/system/backups/restore', { method: 'POST', body: JSON.stringify({ name: backup.name }) });
    uiStore.showToast(t('tools.backupRestored'), 'success', 8000);
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToRestoreBackup') + e.message, 'error');
  } finally {
    backupsLoading.value = false;
    pendingRestoreBackup.value = null;
  }
}

const showConfirmDeleteBackup = ref(false);
const pendingDeleteBackup = ref<BackupEntry | null>(null);

function confirmDeleteBackup(backup: BackupEntry) {
  pendingDeleteBackup.value = backup;
  showConfirmDeleteBackup.value = true;
}

async function deleteBackup() {
  const backup = pendingDeleteBackup.value;
  if (!backup) return;
  try {
    await fetchApi(`/system/backups/${encodeURIComponent(backup.name)}`, { method: 'DELETE' });
    backups.value = backups.value.filter(b => b.name !== backup.name);
    uiStore.showToast(t('tools.backupDeleted'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToDeleteBackup') + e.message, 'error');
  } finally {
    pendingDeleteBackup.value = null;
  }
}

async function downloadBackup(backup: BackupEntry) {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/system/backups/download/${encodeURIComponent(backup.name)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backup.name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToDownloadBackup') + e.message, 'error');
  }
}

function switchTab(tab: Tab) {
  activeTab.value = tab;
  if (tab === 'crontab') loadCrontab();
  if (tab === 'mpd-config') loadMpdConfig();
  if (tab === 'scripts') loadScriptPaths();
  if (tab === 'backups') loadBackups();
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
          <h1 class="text-3xl font-black text-text-main tracking-tight dark:drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">{{ t('tools.title') }}</h1>
          <p class="text-gray-400 font-medium mt-1">{{ t('tools.subtitle') }}</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex flex-wrap gap-2">
        <button @click="switchTab('crontab')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'crontab'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">schedule</span>
          <span>{{ t('tools.tabCrontab') }}</span>
        </button>
        <button @click="switchTab('scripts')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'scripts'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">code</span>
          <span>{{ t('tools.tabScripts') }}</span>
        </button>
        <button v-if="systemStore.installedPackages['mpd']" @click="switchTab('mpd-config')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'mpd-config'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">queue_music</span>
          <span>{{ t('tools.tabMpdConfig') }}</span>
        </button>
        <button @click="switchTab('backups')"
          :class="['flex items-center space-x-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all duration-300 border',
            activeTab === 'backups'
              ? 'bg-brand-primary/20 text-brand-primary border-brand-primary/50 shadow-[0_0_15px_rgb(var(--brand-primary-rgb)/0.3)]'
              : 'bg-black/40 text-terminal-muted border-black/5 dark:border-white/5 hover:border-brand-primary/30 hover:text-gray-300']">
          <span class="material-symbols-outlined text-[1.1rem]">settings_backup_restore</span>
          <span>{{ t('tools.tabBackups') }}</span>
        </button>
      </div>

      <!-- ─── Crontab Editor ───────────────────────────────────────────── -->
      <div v-if="activeTab === 'crontab'" class="space-y-4">
        <div class="bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
          <div class="px-6 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">schedule</span>
              <span class="text-sm font-black text-white uppercase tracking-widest">{{ t('tools.crontabEditor') }}</span>
            </div>
            <div class="flex items-center gap-3">
              <button @click="loadCrontab" :disabled="crontabLoading"
                class="inline-flex items-center px-3 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1" :class="{'animate-spin': crontabLoading}">sync</span>
                {{ t('tools.reload') }}
              </button>
              <button @click="saveCrontab" :disabled="crontabLoading"
                class="inline-flex items-center px-4 py-1.5 text-xs font-black bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl transition-all active:scale-95 uppercase tracking-widest border border-brand-primary/50 disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1">save</span>
                {{ t('tools.save') }}
              </button>
            </div>
          </div>
          <div class="p-4">
            <p class="text-[10px] font-mono text-terminal-muted mb-3 leading-relaxed">
              <i18n-t keypath="tools.crontabFormatLabel"><template #fields><span class="text-terminal-muted">min hour day month weekday command</span></template></i18n-t>&nbsp;&nbsp;
              <i18n-t keypath="tools.crontabExampleLabel"><template #example><span class="text-terminal-muted">*/5 * * * * /path/to/script.sh</span></template></i18n-t>
            </p>
            <textarea
              v-model="crontabContent"
              rows="18"
              spellcheck="false"
              class="w-full bg-black/60 border border-black/5 dark:border-white/5 rounded-xl text-sm font-mono text-gray-200 p-4 focus:outline-none focus:border-brand-primary/50 resize-none leading-relaxed"
              placeholder="# No crontab entries yet&#10;# min hour day month weekday command"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- ─── Script Editor ───────────────────────────────────────────── -->
      <div v-if="activeTab === 'scripts'" class="space-y-4">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">

          <!-- Script List -->
          <div class="bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
            <div class="px-5 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center justify-between">
              <span class="text-sm font-black text-white uppercase tracking-widest">{{ t('tools.tabScripts') }}</span>
              <button @click="showAddForm = !showAddForm"
                class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary rounded-lg transition-all"
                :aria-label="showAddForm ? t('tools.cancelAddScript') : t('tools.addScript')">
                <span class="material-symbols-outlined text-[1rem]">{{ showAddForm ? 'close' : 'add' }}</span>
              </button>
            </div>

            <!-- Add Form -->
            <div v-if="showAddForm" class="p-4 border-b border-black/5 dark:border-white/5 bg-brand-primary/5 space-y-3">
              <input v-model="newScriptLabel" type="text" :placeholder="t('tools.labelPlaceholder')"
                class="w-full bg-black/60 border border-black/10 dark:border-white/10 rounded-xl text-xs font-mono text-gray-200 px-3 py-2 focus:outline-none focus:border-brand-primary/50" />
              <input v-model="newScriptPath" type="text" placeholder="/path/to/script.sh"
                class="w-full bg-black/60 border border-black/10 dark:border-white/10 rounded-xl text-xs font-mono text-gray-200 px-3 py-2 focus:outline-none focus:border-brand-primary/50" />
              <button @click="addScriptPath"
                class="w-full px-3 py-2 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 border border-brand-primary/50">
                {{ t('tools.addScriptButton') }}
              </button>
            </div>

            <!-- Script Items -->
            <div class="divide-y divide-white/5">
              <div v-if="scriptPaths.length === 0" class="px-5 py-8 text-center text-terminal-muted text-xs font-bold uppercase tracking-widest">
                {{ t('tools.noScriptsYet') }}
              </div>
              <div v-for="script in scriptPaths" :key="script.id"
                @click="selectScript(script)"
                :class="['flex items-center justify-between px-5 py-3.5 cursor-pointer transition-all group',
                  selectedScript?.id === script.id ? 'bg-brand-primary/10 border-l-2 border-brand-primary' : 'hover:bg-black/5 dark:hover:bg-white/5']">
                <div class="min-w-0 mr-2">
                  <p class="text-xs font-black text-white truncate">{{ script.label }}</p>
                  <p class="text-[10px] font-mono text-terminal-muted truncate mt-0.5">{{ script.path }}</p>
                </div>
                <button @click.stop="confirmRemoveScript(script.id)"
                  class="opacity-0 group-hover:opacity-100 p-1 min-w-[40px] min-h-[40px] flex items-center justify-center text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-all flex-shrink-0"
                  :aria-label="t('tools.removeScriptFor', { label: script.label })">
                  <span class="material-symbols-outlined text-[0.9rem]">delete</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Script Editor Panel -->
          <div class="lg:col-span-2 bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
            <div class="px-6 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">code</span>
                <span class="text-sm font-black text-white uppercase tracking-widest">
                  {{ selectedScript ? selectedScript.label : t('tools.selectAScript') }}
                </span>
                <span v-if="selectedScript" class="text-[10px] font-mono text-terminal-muted truncate max-w-[200px]">{{ selectedScript.path }}</span>
              </div>
              <button v-if="selectedScript" @click="saveScript" :disabled="scriptLoading"
                class="inline-flex items-center px-4 py-1.5 text-xs font-black bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl transition-all active:scale-95 uppercase tracking-widest border border-brand-primary/50 disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1">save</span>
                {{ t('tools.save') }}
              </button>
            </div>
            <div class="p-4">
              <div v-if="!selectedScript" class="flex flex-col items-center justify-center py-20 text-terminal-muted">
                <span class="material-symbols-outlined text-4xl mb-3">code_off</span>
                <p class="text-xs font-black uppercase tracking-widest">{{ t('tools.selectScriptFromList') }}</p>
              </div>
              <div v-else-if="scriptLoading" class="flex items-center justify-center py-20 text-terminal-muted">
                <span class="material-symbols-outlined animate-spin mr-2">sync</span>
                <span class="text-xs font-black uppercase tracking-widest">{{ t('tools.loading') }}</span>
              </div>
              <textarea
                v-else
                v-model="scriptContent"
                rows="22"
                spellcheck="false"
                class="w-full bg-black/60 border border-black/5 dark:border-white/5 rounded-xl text-sm font-mono text-gray-200 p-4 focus:outline-none focus:border-brand-primary/50 resize-none leading-relaxed"
                placeholder="#!/bin/bash&#10;# Script content..."
              ></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── MPD Config Editor ───────────────────────────────────────── -->
      <div v-if="activeTab === 'mpd-config'" class="space-y-4">
        <div class="bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
          <div class="px-6 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">queue_music</span>
              <span class="text-sm font-black text-white uppercase tracking-widest">{{ t('tools.tabMpdConfig') }}</span>
              <span class="text-[10px] font-mono text-terminal-muted">/etc/mpd.conf</span>
            </div>
            <div class="flex items-center gap-3">
              <button v-if="systemStore.installedPackages['mympd'] && systemStore.mympdRunning" @click="openMympd"
                class="inline-flex items-center px-3 py-1.5 text-xs font-black text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest">
                <span class="material-symbols-outlined text-[1rem] mr-1">open_in_new</span>
                {{ t('tools.openMympd') }}
              </button>
              <button @click="loadMpdConfig" :disabled="mpdConfigLoading"
                class="inline-flex items-center px-3 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1" :class="{'animate-spin': mpdConfigLoading}">sync</span>
                {{ t('tools.reload') }}
              </button>
              <button @click="saveMpdConfig" :disabled="mpdConfigLoading"
                class="inline-flex items-center px-4 py-1.5 text-xs font-black bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl transition-all active:scale-95 uppercase tracking-widest border border-brand-primary/50 disabled:opacity-50">
                <span class="material-symbols-outlined text-[1rem] mr-1">save</span>
                {{ t('tools.save') }}
              </button>
            </div>
          </div>
          <div class="p-4">
            <div class="flex items-center gap-2 mb-3 p-3 bg-[#ffcc00]/5 border border-[#ffcc00]/20 rounded-xl">
              <span class="material-symbols-outlined text-[#ffcc00] text-[1rem]">info</span>
              <p class="text-[10px] font-bold text-[#ffcc00] uppercase tracking-wide">
                {{ t('tools.restartMpdHint') }}
              </p>
              <button @click="systemStore.controlService('restart', 'mpd')" :disabled="systemStore.loading"
                class="ml-auto px-3 py-1 bg-[#ffcc00]/10 hover:bg-[#ffcc00]/20 text-[#ffcc00] border border-[#ffcc00]/20 rounded-lg text-[10px] font-black uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50">
                {{ t('tools.restartMpd') }}
              </button>
            </div>
            <textarea
              v-model="mpdConfigContent"
              rows="28"
              spellcheck="false"
              class="w-full bg-black/60 border border-black/5 dark:border-white/5 rounded-xl text-sm font-mono text-gray-200 p-4 focus:outline-none focus:border-brand-primary/50 resize-none leading-relaxed"
              placeholder="# /etc/mpd.conf&#10;# MPD configuration file"
            ></textarea>
          </div>
        </div>
      </div>

      <!-- ─── Backups ─────────────────────────────────────────────────── -->
      <div v-if="activeTab === 'backups'" class="space-y-4">
        <div class="bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
          <div class="px-6 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">settings_backup_restore</span>
              <span class="text-sm font-black text-white uppercase tracking-widest">{{ t('tools.configurationBackups') }}</span>
            </div>
            <button @click="loadBackups" :disabled="backupsLoading"
              class="inline-flex items-center px-3 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
              <span class="material-symbols-outlined text-[1rem] mr-1" :class="{'animate-spin': backupsLoading}">sync</span>
              {{ t('tools.reload') }}
            </button>
          </div>
          <div class="p-4">
            <p class="text-[10px] font-mono text-terminal-muted mb-3 leading-relaxed">
              {{ t('tools.backupsDescription') }}
            </p>
            <div v-if="backups.length === 0 && !backupsLoading" class="px-5 py-10 text-center text-terminal-muted text-xs font-bold uppercase tracking-widest">
              {{ t('tools.noBackupsYet') }}
            </div>
            <div v-else class="divide-y divide-white/5">
              <div v-for="backup in backups" :key="backup.name"
                class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 hover:bg-black/5 dark:hover:bg-white/5 transition-all rounded-xl">
                <div class="min-w-0">
                  <p class="text-xs font-black text-white truncate font-mono">{{ backup.name }}</p>
                  <p class="text-[10px] font-mono text-terminal-muted mt-0.5">
                    {{ formatDate(backup.mtime) }} · {{ formatSize(backup.size) }}
                    <span v-if="backup.components.length"> · {{ backup.components.join(', ') }}</span>
                  </p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button @click="downloadBackup(backup)"
                    class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-brand-primary hover:bg-brand-primary/10 border border-brand-primary/20 rounded-xl transition-all active:scale-95 uppercase tracking-widest">
                    <span class="material-symbols-outlined text-[0.9rem] mr-1">download</span>
                    {{ t('tools.download') }}
                  </button>
                  <button @click="confirmRestoreBackup(backup)" :disabled="backupsLoading"
                    class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-[#ffcc00] hover:bg-[#ffcc00]/10 border border-[#ffcc00]/20 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
                    <span class="material-symbols-outlined text-[0.9rem] mr-1">restore</span>
                    {{ t('tools.restore') }}
                  </button>
                  <button @click="confirmDeleteBackup(backup)"
                    class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-[#ff3b30] hover:bg-[#ff3b30]/10 border border-[#ff3b30]/20 rounded-xl transition-all active:scale-95 uppercase tracking-widest">
                    <span class="material-symbols-outlined text-[0.9rem] mr-1">delete</span>
                    {{ t('tools.delete') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Confirmations (Task 31) ─────────────────────────────────── -->
      <ConfirmDialog
        v-model="showConfirmRemoveScript"
        :title="t('tools.removeScriptDialogTitle')"
        :message="t('tools.removeScriptDialogMessage')"
        :confirm-text="t('tools.remove')"
        @confirm="removeScriptPath"
      />

      <ConfirmDestructive
        v-model="showConfirmRestoreBackup"
        :title="t('tools.restoreBackupDialogTitle')"
        :message="t('tools.restoreBackupDialogMessage')"
        :entity-name="pendingRestoreBackup?.name ?? ''"
        :confirm-label="t('tools.restore')"
        @confirm="restoreBackup"
      />

      <ConfirmDestructive
        v-model="showConfirmDeleteBackup"
        :title="t('tools.deleteBackupDialogTitle')"
        :message="t('tools.deleteBackupDialogMessage')"
        :entity-name="pendingDeleteBackup?.name ?? ''"
        :confirm-label="t('tools.delete')"
        @confirm="deleteBackup"
      />

    </div>
  </Layout>
</template>
