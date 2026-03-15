<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import { 
    AdjustmentsHorizontalIcon, 
    CodeBracketIcon, 
    ClockIcon, 
    PlusIcon, 
    TrashIcon, 
    ArrowPathIcon,
    DocumentDuplicateIcon
} from '@heroicons/vue/24/outline';

const configStore = useConfigStore();
const systemStore = useSystemStore();
const snapshotStore = useSnapshotStore();
const uiStore = useUIStore();

const activeTab = ref<'basic' | 'advanced' | 'snapshots'>('basic');
const localRawConfig = ref('');
const localParsedConfig = ref<Record<string, any>>({});

const snapshotName = ref('');
const snapshotDescription = ref('');

const fetchBoth = async () => {
  await configStore.fetchServerConfig();
  await configStore.fetchServerConfigParsed();
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
        if (confirm('Configuration saved! Do you want to restart Snapserver now to apply changes?')) {
            await systemStore.controlService('restart', 'snapserver');
            uiStore.showToast('Server restarted successfully', 'success');
        } else {
            uiStore.showToast('Configuration saved (restart required)', 'info');
        }
    } catch (e: any) {
        uiStore.showToast('Failed to save configuration: ' + e.message, 'error');
    }
};

const saveRaw = async () => {
    try {
        await configStore.updateServerConfig(localRawConfig.value);
        await fetchBoth();
        if (confirm('Configuration saved! Do you want to restart Snapserver now to apply changes?')) {
            await systemStore.controlService('restart', 'snapserver');
            uiStore.showToast('Server restarted successfully', 'success');
        } else {
            uiStore.showToast('Configuration saved (restart required)', 'info');
        }
    } catch (e: any) {
        uiStore.showToast('Failed to save configuration: ' + e.message, 'error');
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

const handleRestoreSnapshot = async (id: number) => {
    if (!confirm('Are you sure you want to restore this snapshot? Current configuration will be overwritten.')) return;
    try {
        await snapshotStore.restoreSnapshot(id);
        await fetchBoth();
        uiStore.showToast('Snapshot restored successfully!', 'success');
    } catch (e: any) {
        uiStore.showToast('Failed to restore snapshot: ' + e.message, 'error');
    }
};

const handleDeleteSnapshot = async (id: number) => {
    if (!confirm('Are you sure you want to delete this snapshot?')) return;
    try {
        await snapshotStore.deleteSnapshot(id);
        uiStore.showToast('Snapshot deleted', 'info');
    } catch (e: any) {
        uiStore.showToast('Failed to delete snapshot: ' + e.message, 'error');
    }
};

const addProperty = (section: string) => {
    const key = prompt(`Enter property name for [${section}]:`);
    if (!key) return;
    if (localParsedConfig.value[section][key] !== undefined) {
        uiStore.showToast('Property already exists', 'warning');
        return;
    }
    localParsedConfig.value[section][key] = '';
    uiStore.showToast(`Property "${key}" added to [${section}]`, 'success');
};

const addSection = () => {
    const section = prompt('Enter new section name:');
    if (!section) return;
    if (localParsedConfig.value[section]) {
        uiStore.showToast('Section already exists', 'warning');
        return;
    }
    localParsedConfig.value[section] = {};
    uiStore.showToast(`Section [${section}] created`, 'success');
};

const removeProperty = (section: string, key: string) => {
    if (confirm(`Remove ${key} from [${section}]?`)) {
        delete localParsedConfig.value[section][key];
        uiStore.showToast(`Removed "${key}"`, 'info');
    }
};

const removeSection = (section: string) => {
    if (confirm(`Remove entire section [${section}]?`)) {
        delete localParsedConfig.value[section];
        uiStore.showToast(`Section [${section}] removed`, 'info');
    }
};

</script>

<template>
  <Layout>
      <!-- Tabs Navigation -->
      <div class="mb-8 flex space-x-2 bg-slate-200/50 dark:bg-slate-800/50 p-1.5 rounded-2xl w-fit">
          <button 
            @click="activeTab = 'basic'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm',
                activeTab === 'basic' 
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            ]"
          >
              <AdjustmentsHorizontalIcon class="h-4 w-4" />
              <span>Standard</span>
          </button>
          <button 
            @click="activeTab = 'advanced'"
            :class="[
                'flex items-center space-x-2 px-5 py-2.5 font-bold rounded-xl whitespace-nowrap transition-all duration-300 text-sm',
                activeTab === 'advanced' 
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

      <!-- Basic Tab -->
      <div v-if="activeTab === 'basic'" class="animate-in fade-in slide-in-from-left-4 duration-500">
          <div v-for="(props, section) in localParsedConfig" :key="section" class="mb-8">
              <Card>
                  <template #title>
                      <div class="flex justify-between items-center w-full">
                          <div class="flex items-center space-x-2">
                            <span class="text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Section</span>
                            <span class="text-sm font-black text-slate-800 dark:text-white uppercase">{{ section }}</span>
                          </div>
                          <button @click="removeSection(section)" class="inline-flex items-center px-2 py-1 text-[10px] font-black text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors uppercase tracking-widest">
                            <TrashIcon class="h-3 w-3 mr-1" />
                            Delete Section
                          </button>
                      </div>
                  </template>
                  <div class="space-y-6">
                      <div v-if="Object.keys(props).length === 0" class="text-center py-6 border-2 border-dashed border-slate-100 dark:border-slate-800/50 rounded-xl">
                          <p class="text-xs font-bold text-slate-400 uppercase tracking-widest">No properties defined in this section</p>
                      </div>
                      <div v-for="(value, key) in props" :key="key" class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center group">
                          <div class="md:col-span-1 flex items-center justify-between md:justify-start space-x-3">
                              <label class="text-[10px] font-black text-slate-400 uppercase tracking-[0.1em] truncate">{{ String(key) }}</label>
                              <button @click="removeProperty(section, String(key))" class="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all rounded-md hover:bg-red-50 dark:hover:bg-red-500/10">
                                   <TrashIcon class="h-3.5 w-3.5" />
                              </button>
                          </div>
                          <div class="md:col-span-3">
                              <input 
                                v-if="typeof value !== 'object'"
                                v-model="localParsedConfig[section][String(key)]"
                                class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                              />
                              <div v-else-if="Array.isArray(value)" class="space-y-3">
                                  <div v-for="(_item, idx) in value" :key="idx" class="flex space-x-2">
                                      <input 
                                        v-model="localParsedConfig[section][String(key)][idx]"
                                        class="flex-1 text-sm font-medium px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                                      />
                                      <button @click="localParsedConfig[section][String(key)].splice(idx, 1)" class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                                        <TrashIcon class="h-4 w-4" />
                                      </button>
                                  </div>
                                  <button @click="localParsedConfig[section][String(key)].push('')" class="inline-flex items-center text-[10px] font-black text-indigo-600 dark:text-indigo-400 hover:indigo-700 uppercase tracking-widest">
                                    <PlusIcon class="h-3 w-3 mr-1" />
                                    Add Entry
                                  </button>
                              </div>
                          </div>
                      </div>
                      <div class="pt-4 border-t border-slate-100 dark:border-slate-800/60">
                          <button @click="addProperty(section)" class="inline-flex items-center px-4 py-2 bg-indigo-50 dark:bg-indigo-500/5 text-indigo-600 dark:text-indigo-400 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] hover:bg-indigo-100 dark:hover:bg-indigo-500/10 transition-colors">
                              <PlusIcon class="h-3.5 w-3.5 mr-2" />
                              Add Property to [{{ section }}]
                          </button>
                      </div>
                  </div>
              </Card>
          </div>

          <div class="mb-24">
              <button @click="addSection" class="w-full py-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 dark:text-slate-500 hover:border-indigo-500/50 hover:text-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 transition-all flex flex-col justify-center items-center group">
                  <div class="p-3 bg-slate-100 dark:bg-slate-800 rounded-full group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors mb-2">
                    <PlusIcon class="h-6 w-6" />
                  </div>
                  <span class="text-xs font-black uppercase tracking-widest">Add New Section</span>
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

      <!-- Advanced Tab -->
      <div v-else-if="activeTab === 'advanced'" class="animate-in fade-in slide-in-from-right-4 duration-500">
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

      <!-- Snapshots Tab -->
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
                                  <button @click="handleRestoreSnapshot(snapshot.id)" 
                                    class="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 rounded-lg hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all shadow-sm active:scale-95">
                                      Restore
                                  </button>
                                  <button @click="handleDeleteSnapshot(snapshot.id)"
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
  </Layout>
</template>
