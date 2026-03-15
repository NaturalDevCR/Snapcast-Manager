<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useConfigStore } from '../stores/config';
import { useSnapshotStore } from '../stores/snapshots';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const configStore = useConfigStore();
const snapshotStore = useSnapshotStore();
const activeTab = ref<'basic' | 'advanced' | 'snapshots'>('basic');
const localRawConfig = ref('');
const localParsedConfig = ref<any>({});

const snapshotName = ref('');
const snapshotDescription = ref('');

const streams = computed(() => {
    const s = localParsedConfig.value.stream?.source;
    if (Array.isArray(s)) return s;
    if (s) return [s];
    return [];
});

onMounted(async () => {
    await fetchBoth();
    await snapshotStore.fetchSnapshots();
});

async function fetchBoth() {
  await configStore.fetchServerConfig();
  await configStore.fetchServerConfigParsed();
  localRawConfig.value = configStore.serverConfig;
  localParsedConfig.value = JSON.parse(JSON.stringify(configStore.serverConfigParsed));
}

const saveRaw = async () => {
    try {
        await configStore.updateServerConfig(localRawConfig.value);
        await fetchBoth();
        alert('Configuration saved!');
    } catch (e) {
        alert('Failed to save configuration');
    }
};

const saveParsed = async () => {
    try {
        await configStore.updateServerConfigParsed(localParsedConfig.value);
        await fetchBoth();
        alert('Configuration saved!');
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

const addStream = () => {
    if (!localParsedConfig.value.stream) localParsedConfig.value.stream = {};
    const current = localParsedConfig.value.stream.source;
    const newStream = 'pipe:///tmp/snapfifo?name=NewStream';
    
    if (Array.isArray(current)) {
        current.push(newStream);
    } else if (current) {
        localParsedConfig.value.stream.source = [current, newStream];
    } else {
        localParsedConfig.value.stream.source = [newStream];
    }
};

const removeStream = (index: number) => {
    const current = localParsedConfig.value.stream.source;
    if (Array.isArray(current)) {
        current.splice(index, 1);
        if (current.length === 0) delete localParsedConfig.value.stream.source;
    } else {
        delete localParsedConfig.value.stream.source;
    }
};

const updateStream = (index: number, val: string) => {
    if (Array.isArray(localParsedConfig.value.stream.source)) {
        localParsedConfig.value.stream.source[index] = val;
    } else {
        localParsedConfig.value.stream.source = val;
    }
}

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
          <Card title="Manage Streams">
              <div class="space-y-4">
                  <div v-if="streams.length === 0" class="text-gray-500 dark:text-gray-400">
                      No streams configured.
                  </div>
                  <div v-for="(stream, index) in streams" :key="index" class="flex items-center space-x-2">
                       <input 
                          type="text" 
                          :value="stream"
                          @input="e => updateStream(index, (e.target as HTMLInputElement).value)"
                          class="flex-1 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white p-2 border"
                       />
                       <button @click="removeStream(index)" class="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300">
                           <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                               <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                           </svg>
                       </button>
                  </div>
                  <div class="pt-2">
                      <button @click="addStream" class="flex items-center text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                          </svg>
                          Add Stream
                      </button>
                  </div>
              </div>
          </Card>

           <div class="mt-6 flex justify-end">
              <button 
                  @click="saveParsed" 
                  :disabled="configStore.loading"
                  class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                  Save Changes
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
