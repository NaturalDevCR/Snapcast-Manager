<script setup lang="ts">
import { onMounted } from 'vue';
import { useSystemStore } from '../stores/system';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const systemStore = useSystemStore();

onMounted(() => {
  systemStore.refreshAll();
});
</script>

<template>
  <Layout>
    <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <!-- server Status -->
      <Card title="Snapserver">
        <div class="flex items-center justify-between">
            <span class="text-gray-600 dark:text-gray-300">Installed:</span>
            <span :class="systemStore.installedPackages.snapserver ? 'text-green-500' : 'text-red-500'">
                {{ systemStore.installedPackages.snapserver ? 'Yes' : 'No' }}
            </span>
        </div>
        <div class="flex items-center justify-between mt-2" v-if="systemStore.installedPackages.snapserver">
             <span class="text-gray-600 dark:text-gray-300">Status:</span>
             <span :class="systemStore.snapserverStatus === 'active' ? 'text-green-500' : 'text-yellow-500'">
                 {{ systemStore.snapserverStatus }}
             </span>
        </div>
        <div class="mt-4 flex space-x-2" v-if="systemStore.installedPackages.snapserver">
            <button @click="systemStore.controlService('restart', 'snapserver')" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Restart</button>
            <button v-if="systemStore.snapserverStatus === 'active'" @click="systemStore.controlService('stop', 'snapserver')" class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm">Stop</button>
            <button v-else @click="systemStore.controlService('start', 'snapserver')" class="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm">Start</button>
        </div>
        <div class="mt-4" v-else>
             <button @click="systemStore.installPackage('snapserver')" class="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Install Snapserver</button>
        </div>
      </Card>

      <!-- Client Status -->
      <Card title="Snapclient">
        <div class="flex items-center justify-between">
            <span class="text-gray-600 dark:text-gray-300">Installed:</span>
            <span :class="systemStore.installedPackages.snapclient ? 'text-green-500' : 'text-red-500'">
                {{ systemStore.installedPackages.snapclient ? 'Yes' : 'No' }}
            </span>
        </div>
        <div class="flex items-center justify-between mt-2" v-if="systemStore.installedPackages.snapclient">
             <span class="text-gray-600 dark:text-gray-300">Status:</span>
             <span :class="systemStore.snapclientStatus === 'active' ? 'text-green-500' : 'text-yellow-500'">
                 {{ systemStore.snapclientStatus }}
             </span>
        </div>
        <div class="mt-4 flex space-x-2" v-if="systemStore.installedPackages.snapclient">
            <button @click="systemStore.controlService('restart', 'snapclient')" class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Restart</button>
            <button v-if="systemStore.snapclientStatus === 'active'" @click="systemStore.controlService('stop', 'snapclient')" class="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm">Stop</button>
            <button v-else @click="systemStore.controlService('start', 'snapclient')" class="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm">Start</button>
        </div>
        <div class="mt-4" v-else>
             <button @click="systemStore.installPackage('snapclient')" class="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Install Snapclient</button>
        </div>
      </Card>

      <!-- FFmpeg Status -->
      <Card title="FFmpeg">
        <div class="flex items-center justify-between">
            <span class="text-gray-600 dark:text-gray-300">Installed:</span>
            <span :class="systemStore.installedPackages.ffmpeg ? 'text-green-500' : 'text-red-500'">
                {{ systemStore.installedPackages.ffmpeg ? 'Yes' : 'No' }}
            </span>
        </div>
        <div class="mt-4" v-if="!systemStore.installedPackages.ffmpeg">
             <button @click="systemStore.installPackage('ffmpeg')" class="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Install FFmpeg</button>
        </div>
        <div class="mt-4" v-else>
            <p class="text-sm text-green-600 dark:text-green-400">FFmpeg is ready to use for streams.</p>
        </div>
      </Card>
    </div>
  </Layout>
</template>
