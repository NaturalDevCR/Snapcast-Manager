<script setup lang="ts">
import Layout from '../components/Layout.vue';
import { useSnapcastStore } from '../stores/snapcast';
import { onMounted, onUnmounted, ref } from 'vue';

const snapcastStore = useSnapcastStore();
let refreshInterval: any = null;
const renamingClientId = ref<string | null>(null);
const newClientName = ref('');

onMounted(() => {
    snapcastStore.fetchStatus();
    refreshInterval = setInterval(() => {
        snapcastStore.fetchStatus();
    }, 2000);
});

onUnmounted(() => {
    if (refreshInterval) clearInterval(refreshInterval);
});

const startRename = (clientId: string, currentName: string) => {
    renamingClientId.value = clientId;
    newClientName.value = currentName;
};

const cancelRename = () => {
    renamingClientId.value = null;
    newClientName.value = '';
};

const submitRename = async (clientId: string) => {
    if (newClientName.value.trim()) {
        await snapcastStore.setClientName(clientId, newClientName.value.trim());
        renamingClientId.value = null;
    }
};

const getStreamLabel = (stream: any) => {
    if (stream.uri?.query?.name) return stream.uri.query.name;
    return stream.id || 'Unknown Stream';
};

const updateVolume = (client: any, event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target) {
        snapcastStore.setClientVolume(client.id, { 
            percent: Number(target.value), 
            muted: client.config.volume.muted 
        });
    }
};
</script>

<template>
  <Layout>
    <div class="space-y-6">
      <!-- Page Header -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-black/40 backdrop-blur-3xl border border-white/5 p-6 rounded-3xl shadow-2xl relative overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-r from-brand-primary/10 to-transparent pointer-events-none"></div>
        <div class="relative z-10 flex items-center space-x-3">
            <div class="p-3 bg-brand-primary/20 rounded-2xl border border-brand-primary/30 shadow-[0_0_20px_rgba(166,13,242,0.3)]">
                <span class="material-symbols-outlined text-brand-primary text-3xl">hub</span>
            </div>
            <div>
                <h1 class="text-2xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">Audio Matrix</h1>
                <p class="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">Route Streams to Zones</p>
            </div>
        </div>
        <button @click="snapcastStore.fetchStatus()" :disabled="snapcastStore.loading" class="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-black border border-white/5 backdrop-blur-xl transition-all active:scale-95 flex items-center gap-2 group">
            <span class="material-symbols-outlined text-sm group-hover:rotate-180 transition-transform" :class="{'animate-spin': snapcastStore.loading}">refresh</span>
            Sync
        </button>
      </div>

      <!-- Main Matrix Card -->
      <div class="bg-black/40 backdrop-blur-3xl border border-white/5 rounded-3xl shadow-2xl overflow-hidden relative">
        <!-- Error State -->
        <div v-if="snapcastStore.error" class="p-4 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm font-bold flex items-center gap-2">
            <span class="material-symbols-outlined text-base">error</span>
            {{ snapcastStore.error }}
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr class="bg-white/[0.02] border-b border-white/5">
                <th class="p-6 text-xs font-black text-gray-400 uppercase tracking-widest w-1/4">Zone (Group)</th>
                <th v-for="stream in snapcastStore.status?.streams" :key="stream.id" class="p-6 text-xs font-black text-gray-400 uppercase tracking-widest text-center w-48">
                  <div class="flex flex-col items-center gap-1 group">
                    <span class="text-white group-hover:text-brand-primary transition-colors">{{ getStreamLabel(stream) }}</span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full border border-white/10" :class="stream.status === 'playing' ? 'text-[#00ff9d] bg-[#00ff9d]/10' : 'text-gray-500 bg-white/5'">
                      {{ stream.status }}
                    </span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- Empty State -->
              <tr v-if="!snapcastStore.status?.groups.length">
                <td :colspan="(snapcastStore.status?.streams.length || 0) + 1" class="p-12 text-center text-gray-500 italic">
                    <span class="material-symbols-outlined text-4xl mb-2 block">speaker_group</span>
                    No groups found on Snapserver
                </td>
              </tr>

              <!-- Group Rows -->
              <template v-for="group in snapcastStore.status?.groups" :key="group.id">
                <tr class="border-t border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-colors duration-300">
                  <!-- Group Label & Controls -->
                  <td class="p-6">
                    <div class="flex items-center space-x-3">
                      <div class="p-2 rounded-xl bg-brand-primary/10 text-brand-primary border border-brand-primary/20">
                          <span class="material-symbols-outlined text-xl">speaker_group</span>
                      </div>
                      <div class="flex-grow">
                          <div class="font-black text-white">{{ group.name || 'Zone ' + group.id.slice(0,4) }}</div>
                          <div class="text-[11px] text-gray-500 font-bold uppercase tracking-wider">{{ group.clients.length }} Clients</div>
                      </div>
                      <button @click="snapcastStore.setGroupMute(group.id, !group.muted)" class="p-2 rounded-lg transition-colors border" :class="group.muted ? 'bg-red-500/20 text-red-500 border-red-500/20' : 'bg-white/5 text-gray-400 border-white/5 hover:text-white'">
                          <span class="material-symbols-outlined text-lg">{{ group.muted ? 'volume_off' : 'volume_up' }}</span>
                      </button>
                    </div>
                  </td>

                  <!-- Route Matrix Selectors -->
                  <td v-for="stream in snapcastStore.status?.streams" :key="stream.id" class="p-6 text-center">
                    <button 
                      @click="snapcastStore.setGroupStream(group.id, stream.id)" 
                      class="w-8 h-8 rounded-2xl border-2 transition-all duration-300 flex items-center justify-center mx-auto group"
                      :class="group.stream_id === stream.id 
                        ? 'border-[#00ff9d] bg-[#00ff9d]/20 shadow-[0_0_15px_rgba(0,255,157,0.3)]' 
                        : 'border-white/10 bg-white/5 hover:border-white/30'"
                    >
                      <div class="w-2.5 h-2.5 rounded-full transition-all duration-300" 
                        :class="group.stream_id === stream.id 
                          ? 'bg-[#00ff9d] scale-100' 
                          : 'bg-transparent scale-0 group-hover:bg-white/40 group-hover:scale-75'">
                      </div>
                    </button>
                  </td>
                </tr>

                <!-- Connected Clients Sub-row -->
                <tr class="border-b border-white/5 bg-black/20">
                  <td :colspan="(snapcastStore.status?.streams.length || 0) + 1" class="p-4">
                    <div class="border-l-2 border-brand-primary/40 pl-6 space-y-3">
                        <div v-for="client in group.clients" :key="client.id" class="flex flex-col sm:flex-row items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all max-w-4xl gap-4">
                            <!-- Client Name / Rename -->
                            <div class="flex items-center space-x-3 flex-grow">
                                <span class="material-symbols-outlined p-1.5 rounded-lg bg-white/5" :class="client.connected ? 'text-[#00ff9d]' : 'text-gray-500'">smartphone</span>
                                
                                <div v-if="renamingClientId === client.id" class="flex items-center space-x-2">
                                    <input type="text" v-model="newClientName" class="bg-black/60 border border-brand-primary/40 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-primary w-40">
                                    <button @click="submitRename(client.id)" class="p-1 text-[#00ff9d] hover:bg-[#00ff9d]/10 rounded-md"><span class="material-symbols-outlined text-sm">check</span></button>
                                    <button @click="cancelRename()" class="p-1 text-red-400 hover:bg-red-400/10 rounded-md"><span class="material-symbols-outlined text-sm">close</span></button>
                                </div>
                                <div v-else class="group/name flex items-center space-x-1">
                                    <span class="text-sm font-bold text-gray-200">{{ client.config.name || client.host.name || 'Unnamed Client' }}</span>
                                    <button @click="startRename(client.id, client.config.name || client.host.name)" class="opacity-0 group-hover/name:opacity-100 p-1 hover:text-white transition-opacity text-gray-500"><span class="material-symbols-outlined text-xs">edit</span></button>
                                </div>
                                <span v-if="!client.connected" class="text-[9px] font-black uppercase text-gray-500">Offline</span>
                            </div>

                            <!-- Client Volume & Mute -->
                            <div class="flex items-center space-x-3 w-full sm:w-auto">
                                <button @click="snapcastStore.setClientVolume(client.id, { percent: client.config.volume.percent, muted: !client.config.volume.muted })" class="p-1.5 rounded-lg transition-colors border" :class="client.config.volume.muted ? 'bg-red-500/20 text-red-500 border-red-500/20' : 'bg-white/5 text-gray-400 border-white/5 hover:text-white'">
                                    <span class="material-symbols-outlined text-base">{{ client.config.volume.muted ? 'volume_off' : 'volume_up' }}</span>
                                </button>
                                <div class="relative flex-grow sm:w-36 flex items-center">
                                    <input type="range" class="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-brand-primary" min="0" max="100" v-model="client.config.volume.percent" @change="updateVolume(client, $event)">
                                </div>
                                <span class="text-xs font-black text-gray-300 w-8 text-right">{{ client.config.volume.percent }}%</span>
                            </div>
                        </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Layout>
</template>

<style scoped>
input[type=range]::-webkit-slider-thumb {
  height: 12px;
  width: 12px;
  border-radius: 50%;
  background: #a60df2;
  box-shadow: 0 0 10px rgba(166, 13, 242, 0.4);
}
</style>
