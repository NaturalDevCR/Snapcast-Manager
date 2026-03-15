<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import { useSystemStore } from '../stores/system';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const configStore = useConfigStore();
const systemStore = useSystemStore();
const snapshotStore = useSnapshotStore();
const activeTab = ref<'basic' | 'advanced' | 'snapshots'>('basic');
const localRawConfig = ref('');
const localParsedConfig = ref<any>({});

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
            alert('Server restarted.');
        }
    } catch (e) {
        alert('Failed to save configuration');
    }
};

const saveRaw = async () => {
    try {
        await configStore.updateServerConfig(localRawConfig.value);
        await fetchBoth();
        if (confirm('Configuration saved! Do you want to restart Snapserver now to apply changes?')) {
            await systemStore.controlService('restart', 'snapserver');
            alert('Server restarted.');
        }
    } catch (e) {
        alert('Failed to save configuration');
    }
};

const handleCreateSnapshot = async () => {
    if (!snapshotName.value) return;
    try {
        await snapshotStore.createSnapshot(snapshotName.value, snapshotDescription.value);
        snapshotName.value = '';
        snapshotDescription.value = '';
        alert('Snapshot created successfully!');
    } catch (e) {
        alert('Failed to create snapshot');
    }
};

const handleRestoreSnapshot = async (id: number) => {
    if (!confirm('Are you sure you want to restore this snapshot? Current configuration will be overwritten.')) return;
    try {
        await snapshotStore.restoreSnapshot(id);
        await fetchBoth();
        alert('Snapshot restored successfully!');
    } catch (e) {
        alert('Failed to restore snapshot');
    }
};

const handleDeleteSnapshot = async (id: number) => {
    if (!confirm('Are you sure you want to delete this snapshot?')) return;
    try {
        await snapshotStore.deleteSnapshot(id);
    } catch (e) {
        alert('Failed to delete snapshot');
    }
};

</script>

<template>
  <Layout>
      <div class="mb-6 flex space-x-2 overflow-x-auto pb-2">
          <button 
            @click="activeTab = 'basic'"
            :class="[
                'px-4 py-2 font-medium rounded-md whitespace-nowrap transition-colors',
                activeTab === 'basic' 
                ? 'bg-indigo-600 text-white' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-800'
            ]"
          >
              Streams & Basic UI
          </button>
          <button 
            @click="activeTab = 'advanced'"
            :class="[
                'px-4 py-2 font-medium rounded-md whitespace-nowrap transition-colors',
                activeTab === 'advanced' 
                ? 'bg-indigo-600 text-white' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-800'
            ]"
          >
              Advanced (Edit .conf)
          </button>
          <button 
            @click="activeTab = 'snapshots'"
            :class="[
                'px-4 py-2 font-medium rounded-md whitespace-nowrap transition-colors',
                activeTab === 'snapshots' 
                ? 'bg-indigo-600 text-white' 
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 bg-gray-100 dark:bg-gray-800'
            ]"
          >
              Snapshots & Rollback
          </button>
      </div>

      <!-- Basic Tab -->
      <div v-if="activeTab === 'basic'">
          <!-- All Categories Section -->
          <div v-for="(props, section) in localParsedConfig" :key="section" class="mb-6">
              <Card :title="`Section: [${section}]`">
                  <div class="space-y-3">
                      <div v-for="(value, key) in props" :key="key" class="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-gray-100 dark:border-gray-700 pb-3 last:border-0 last:pb-0">
                          <label class="text-xs font-semibold text-gray-500 uppercase tracking-wider self-center">{{ key }}</label>
                          <div class="md:col-span-2">
                              <input 
                                v-if="typeof value !== 'object'"
                                v-model="localParsedConfig[section][key]"
                                class="w-full text-sm p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                              />
                              <div v-else-if="Array.isArray(value)" class="space-y-2">
                                  <div v-for="(_item, idx) in value" :key="idx" class="flex space-x-2">
                                      <input 
                                        v-model="localParsedConfig[section][key][idx]"
                                        class="flex-1 text-sm p-2 border rounded-md dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                      />
                                      <button @click="localParsedConfig[section][key].splice(idx, 1)" class="text-red-500">×</button>
                                  </div>
                                  <button @click="localParsedConfig[section][key].push('')" class="text-xs text-indigo-500">+ Add line</button>
                              </div>
                          </div>
                      </div>
                  </div>
              </Card>
          </div>

           <div class="mt-6 flex justify-end sticky bottom-6 z-10">
              <button 
                  @click="saveParsed" 
                  :disabled="configStore.loading"
                  class="px-6 py-3 border border-transparent rounded-full shadow-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-transform active:scale-95"
              >
                  Save Configuration
              </button>
          </div>
      </div>

      <!-- Advanced Tab -->
      <div v-else-if="activeTab === 'advanced'">
          <Card title="Raw Configuration">
              <div class="space-y-4">
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                      Edit the raw configuration file for Snapcast Server.
                  </p>
                  <textarea 
                      v-model="localRawConfig" 
                      class="w-full h-96 font-mono text-sm p-4 border rounded-md dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 focus:ring-indigo-500 focus:border-indigo-500"
                      spellcheck="false"
                  ></textarea>
                  <div class="flex justify-end">
                      <button 
                          @click="saveRaw" 
                          :disabled="configStore.loading"
                          class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                      >
                          Save Raw Configuration
                      </button>
                  </div>
              </div>
          </Card>
      </div>

      <!-- Snapshots Tab -->
      <div v-else-if="activeTab === 'snapshots'">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div class="lg:col-span-1">
                  <Card title="New Snapshot">
                      <div class="space-y-4">
                          <div>
                              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
                              <input v-model="snapshotName" type="text" placeholder="e.g. Before update" 
                                class="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-gray-700 dark:text-white sm:text-sm">
                          </div>
                          <div>
                              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Description (Optional)</label>
                              <textarea v-model="snapshotDescription" placeholder="What changed?" 
                                class="mt-1 block w-full border border-gray-300 dark:border-gray-600 rounded-md shadow-sm p-2 bg-white dark:bg-gray-700 dark:text-white sm:text-sm h-24"></textarea>
                          </div>
                          <button 
                            @click="handleCreateSnapshot"
                            :disabled="snapshotStore.loading || !snapshotName"
                            class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                          >
                            Create Snapshot
                          </button>
                      </div>
                  </Card>
              </div>
              <div class="lg:col-span-2">
                  <Card title="Available Snapshots">
                      <div v-if="snapshotStore.loading && snapshotStore.snapshots.length === 0" class="flex justify-center py-8">
                          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      </div>
                      <div v-else-if="snapshotStore.snapshots.length === 0" class="text-center py-12 text-gray-500 dark:text-gray-400">
                          No snapshots available yet.
                      </div>
                      <div v-else class="space-y-4">
                          <div v-for="snapshot in snapshotStore.snapshots" :key="snapshot.id" 
                            class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg flex justify-between items-start hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                              <div>
                                  <h4 class="font-bold text-gray-900 dark:text-white">{{ snapshot.name }}</h4>
                                  <p v-if="snapshot.description" class="text-sm text-gray-600 dark:text-gray-400 mt-1">{{ snapshot.description }}</p>
                                  <p class="text-xs text-gray-400 mt-2">{{ new Date(snapshot.timestamp).toLocaleString() }}</p>
                              </div>
                              <div class="flex space-x-2">
                                  <button @click="handleRestoreSnapshot(snapshot.id)" 
                                    class="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 px-3 py-1 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors">
                                      Restore
                                  </button>
                                  <button @click="handleDeleteSnapshot(snapshot.id)"
                                    class="text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 px-3 py-1 rounded-md hover:bg-red-200 dark:hover:bg-red-800 transition-colors">
                                      Delete
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
