<script setup lang="ts">
import { onMounted } from 'vue';
import { useSystemStore } from '../stores/system';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import { ServerIcon, GlobeAltIcon, VideoCameraIcon, SpeakerWaveIcon } from '@heroicons/vue/24/outline';

const systemStore = useSystemStore();

onMounted(() => {
  systemStore.refreshAll();
});

const handleUpdate = async (pkg: 'snapserver' | 'ffmpeg' | 'shairport-sync') => {
  try {
    await systemStore.updatePackage(pkg);
    alert(`${pkg} updated successfully!`);
  } catch (err: any) {
    alert(`Failed to update ${pkg}: ` + err.message);
  }
};

const handleInstallSnapCtrl = async () => {
  try {
    await systemStore.installSnapCtrl();
    alert('Snap-ctrl installed and configured successfully!');
  } catch (err: any) {
    alert('Failed to install snap-ctrl: ' + err.message);
  }
};
// Version from package.json or hardcoded since we are in a monorepo
const version = 'v0.1.2';
</script>

<template>
  <Layout>
    <div class="relative min-h-[60vh]">
      <!-- Loading Overlay -->
      <div v-if="systemStore.loading" class="absolute inset-0 z-50 flex items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-xl">
          <div class="flex flex-col items-center">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-2"></div>
              <span class="text-sm font-medium text-gray-700 dark:text-gray-200">Processing...</span>
          </div>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <!-- server Status -->
      <Card title="Snapserver">
        <template #icon>
            <ServerIcon class="h-6 w-6 text-indigo-500" />
        </template>
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
        <div class="flex items-center justify-between mt-2" v-if="systemStore.installedPackages.snapserver">
             <span class="text-gray-600 dark:text-gray-300 text-xs">Version: {{ systemStore.packageVersions.snapserver || '...' }}</span>
        </div>
        <div class="mt-4 flex flex-col space-y-2" v-if="systemStore.installedPackages.snapserver">
            <div class="flex space-x-2">
                <button @click="systemStore.controlService('restart', 'snapserver')" class="flex-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Restart</button>
                <button v-if="systemStore.snapserverStatus === 'active'" @click="systemStore.controlService('stop', 'snapserver')" class="flex-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Stop</button>
                <button v-else @click="systemStore.controlService('start', 'snapserver')" class="flex-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Start</button>
            </div>
            <button @click="handleUpdate('snapserver')" class="w-full px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/50 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Update Snapserver</button>
        </div>
        <div class="mt-4" v-else>
             <button @click="systemStore.installPackage('snapserver')" class="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Install Snapserver</button>
        </div>
      </Card>

      <!-- Snap-ctrl Status -->
      <Card title="Snap-ctrl">
        <template #icon>
            <GlobeAltIcon class="h-6 w-6 text-pink-500" />
        </template>
        <div class="flex items-center justify-between">
            <span class="text-gray-600 dark:text-gray-300">Status:</span>
            <span :class="systemStore.installedPackages['snap-ctrl'] ? 'text-green-500' : 'text-yellow-500'">
                {{ systemStore.installedPackages['snap-ctrl'] ? 'Installed' : 'Not Installed' }}
            </span>
        </div>
        <div class="flex items-center justify-between mt-1">
            <span class="text-xs text-gray-500">Version: {{ systemStore.packageVersions['snap-ctrl'] || '...' }}</span>
        </div>
        <p class="text-[10px] text-gray-500 mt-2">Modern web interface for Snapcast.</p>
        <div class="mt-4">
             <button @click="handleInstallSnapCtrl" class="w-full px-4 py-2 bg-pink-600 text-white rounded hover:bg-pink-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">
                {{ systemStore.installedPackages['snap-ctrl'] ? 'Update Snap-ctrl' : 'Install Snap-ctrl' }}
             </button>
        </div>
        <p v-if="systemStore.installedPackages['snap-ctrl']" class="mt-2 text-[10px] text-center text-gray-400">
            Access via port 1780
        </p>
      </Card>

      <!-- FFmpeg Status -->
      <Card title="FFmpeg">
        <template #icon>
            <VideoCameraIcon class="h-6 w-6 text-purple-500" />
        </template>
        <div class="flex items-center justify-between">
            <span class="text-gray-600 dark:text-gray-300">Installed:</span>
            <span :class="systemStore.installedPackages.ffmpeg ? 'text-green-500' : 'text-red-500'">
                {{ systemStore.installedPackages.ffmpeg ? 'Yes' : 'No' }}
            </span>
        </div>
        <div class="flex items-center justify-between mt-1" v-if="systemStore.installedPackages.ffmpeg">
             <span class="text-gray-600 dark:text-gray-300 text-xs">Version: {{ systemStore.packageVersions.ffmpeg || '...' }}</span>
        </div>
        <div class="mt-4" v-if="!systemStore.installedPackages.ffmpeg">
             <button @click="systemStore.installPackage('ffmpeg')" class="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Install FFmpeg</button>
        </div>
        <div class="mt-4 flex flex-col space-y-2" v-else>
            <p class="text-xs text-green-600 dark:text-green-400">FFmpeg is ready to use for streams.</p>
            <button @click="handleUpdate('ffmpeg')" class="w-full px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Update FFmpeg</button>
        </div>
      </Card>

      <!-- Shairport-sync (AirPlay) Status -->
      <Card title="AirPlay (Shairport)">
        <template #icon>
            <SpeakerWaveIcon class="h-6 w-6 text-orange-500" />
        </template>
        <div class="flex items-center justify-between">
            <span class="text-gray-600 dark:text-gray-300">Installed:</span>
            <span :class="systemStore.installedPackages['shairport-sync'] ? 'text-green-500' : 'text-red-500'">
                {{ systemStore.installedPackages['shairport-sync'] ? 'Yes' : 'No' }}
            </span>
        </div>
        <div class="flex items-center justify-between mt-2" v-if="systemStore.installedPackages['shairport-sync']">
             <span class="text-gray-600 dark:text-gray-300">Status:</span>
             <span :class="systemStore.shairportSyncStatus === 'active' ? 'text-green-500' : 'text-yellow-500'">
                 {{ systemStore.shairportSyncStatus }}
             </span>
        </div>
        <div class="flex items-center justify-between mt-2" v-if="systemStore.installedPackages['shairport-sync']">
             <span class="text-gray-600 dark:text-gray-300 text-xs">Version: {{ systemStore.packageVersions['shairport-sync'] || '...' }}</span>
        </div>
        <div class="mt-4 flex flex-col space-y-2" v-if="systemStore.installedPackages['shairport-sync']">
            <div class="flex space-x-2">
                <button @click="systemStore.controlService('restart', 'shairport-sync')" class="flex-1 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Restart</button>
                <button v-if="systemStore.shairportSyncStatus === 'active'" @click="systemStore.controlService('stop', 'shairport-sync')" class="flex-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Stop</button>
                <button v-else @click="systemStore.controlService('start', 'shairport-sync')" class="flex-1 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Start</button>
            </div>
            <button @click="handleUpdate('shairport-sync')" class="w-full px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded hover:bg-orange-200 dark:hover:bg-orange-900/50 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Update Shairport</button>
        </div>
        <div class="mt-4" v-else>
             <button @click="systemStore.installPackage('shairport-sync')" class="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" :disabled="systemStore.loading">Install Shairport-sync</button>
        </div>
      </Card>
    </div>

    <!-- Footer with Version -->
    <div class="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700 text-center">
        <p class="text-sm text-gray-500 dark:text-gray-400">
            Snapcast Manager <span class="font-semibold">{{ version }}</span>
        </p>
    </div>
  </div>
  </Layout>
</template>
