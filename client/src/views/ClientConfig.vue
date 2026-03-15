<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../stores/config';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const configStore = useConfigStore();
// Simple key-value pairs for now
const configKeys = ref(['SNAPCLIENT_OPTS', 'START_SNAPCLIENT']);
const form = ref<Record<string, string>>({});

onMounted(async () => {
  await configStore.fetchClientConfig();
  form.value = { ...configStore.clientConfig };
});

const save = async () => {
    try {
        await configStore.updateClientConfig(form.value);
        alert('Configuration saved!');
    } catch (e) {
        alert('Failed to save configuration');
    }
};
</script>

<template>
  <Layout>
      <Card title="Client Configuration (/etc/default/snapclient)">
          <div class="space-y-6">
              <div v-for="key in configKeys" :key="key">
                  <label :for="key" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {{ key }}
                  </label>
                  <div class="mt-1">
                      <input 
                          type="text" 
                          :name="key" 
                          :id="key" 
                          v-model="form[key]"
                          class="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-indigo-500 dark:focus:border-indigo-500 p-2 border"
                      />
                  </div>
              </div>
              
              <div class="flex justify-end">
                  <button 
                      @click="save" 
                      :disabled="configStore.loading"
                      class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                      Save Configuration
                  </button>
              </div>
          </div>
      </Card>
  </Layout>
</template>
