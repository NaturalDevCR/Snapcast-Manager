<script setup lang="ts">
import Layout from '../components/Layout.vue';
import { useSnapcastStore } from '../stores/snapcast';
import { onMounted, onUnmounted, ref } from 'vue';

const vFocus = {
  mounted: (el: HTMLElement) => el.focus()
};

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
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-brand-surface/40 backdrop-blur-3xl border border-white/[0.03] p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
        <div class="absolute inset-0 bg-gradient-to-r from-brand-primary/5 to-transparent pointer-events-none"></div>
        <div class="relative z-10 flex items-center space-x-4">
            <div class="p-4 bg-brand-primary/10 rounded-2xl border border-brand-primary/20 shadow-lg shadow-brand-primary/20 group-hover:shadow-xl group-hover:shadow-brand-primary/40 transition-all duration-500">
                <span class="material-symbols-outlined text-brand-primary text-3xl">hub</span>
            </div>
            <div>
                <h1 class="text-3xl font-black text-text-main tracking-tight">Audio Matrix</h1>
                <p class="text-[10px] text-white/40 font-black uppercase tracking-[0.3em] mt-1">Infrastructure Routing & Zone Control</p>
            </div>
        </div>
        <button @click="snapcastStore.fetchStatus()" :disabled="snapcastStore.loading" 
                class="px-6 py-3 bg-white/[0.03] hover:bg-white/[0.08] text-white rounded-2xl text-xs font-black border border-white/[0.05] backdrop-blur-xl transition-all active:scale-95 flex items-center gap-3 group/btn shadow-xl">
            <span class="material-symbols-outlined text-sm group-hover/btn:rotate-180 transition-transform duration-700" :class="{'animate-spin': snapcastStore.loading}">refresh</span>
            RE-SYNC INFRASTRUCTURE
        </button>
      </div>

      <!-- Matrix Grid -->
      <div v-if="snapcastStore.status" class="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12">
        <div v-for="group in snapcastStore.status.groups" :key="group.id" 
             class="bg-brand-surface/40 backdrop-blur-3xl border border-white/[0.03] rounded-[2.5rem] overflow-hidden shadow-2xl transition-all duration-500 hover:border-brand-primary/30 hover:shadow-brand-primary/5 group/card relative">
          
          <!-- Card Header (Zone & Stream) -->
          <div class="p-8 border-b border-white/[0.03] bg-white/[0.01]">
            <div class="flex items-center justify-between mb-8">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary border border-brand-primary/20 group-hover/card:scale-110 transition-transform duration-500">
                  <span class="material-symbols-outlined">speaker_group</span>
                </div>
                <div>
                  <h3 class="text-xl font-black text-white tracking-tight">{{ group.name || 'Zone ' + group.id.slice(0,4) }}</h3>
                  <p class="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">{{ group.clients.length }} TARGET DESTINATIONS</p>
                </div>
              </div>
              <button @click="snapcastStore.setGroupMute(group.id, !group.muted)" 
                      class="w-12 h-12 rounded-2xl transition-all duration-300 border flex items-center justify-center group/mute shadow-lg"
                      :class="group.muted ? 'bg-red-500/20 text-red-500 border-red-500/30 shadow-red-500/10' : 'bg-white/[0.03] text-white/40 border-white/[0.05] hover:text-white hover:border-white/20'">
                <span class="material-symbols-outlined text-xl transition-transform group-hover/mute:scale-110">{{ group.muted ? 'volume_off' : 'volume_up' }}</span>
              </button>
            </div>

            <!-- Stream Selector Chips -->
            <div class="space-y-3">
              <label class="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] px-1">Source Stream</label>
              <div class="flex flex-wrap gap-2">
                <button v-for="stream in snapcastStore.status.streams" :key="stream.id"
                        @click="snapcastStore.setGroupStream(group.id, stream.id)"
                        class="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all duration-300 relative overflow-hidden"
                        :class="group.stream_id === stream.id 
                          ? 'border-brand-primary bg-brand-primary/20 text-white shadow-lg shadow-brand-primary/20' 
                          : 'border-white/[0.05] bg-white/[0.02] text-white/40 hover:text-white/80 hover:border-white/20'">
                  <div v-if="group.stream_id === stream.id" class="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent"></div>
                  <span class="relative z-10 flex items-center gap-2">
                    <div class="w-1.5 h-1.5 rounded-full" :class="stream.status === 'playing' ? 'bg-[#00ff9d] animate-pulse' : 'bg-white/20'"></div>
                    {{ getStreamLabel(stream) }}
                  </span>
                </button>
              </div>
            </div>
          </div>

          <!-- Clients List -->
          <div class="p-8 space-y-4 bg-black/20">
            <div class="flex items-center justify-between px-1 mb-4">
              <span class="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Destination Nodes</span>
              <span class="text-[9px] font-black text-brand-primary">VOL CONTROL</span>
            </div>

            <div v-for="client in group.clients" :key="client.id" 
                 class="p-5 rounded-3xl bg-white/[0.02] border border-white/[0.03] hover:bg-white/[0.04] transition-all duration-300 group/client">
              <div class="flex items-center justify-between gap-6">
                <!-- Client Info / Rename -->
                <div class="flex items-center gap-4 min-w-0">
                  <div class="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                    <span class="material-symbols-outlined text-lg" :class="client.connected ? 'text-brand-accent' : 'text-white/10'">
                      {{ client.config.name ? 'speaker' : 'smartphone' }}
                    </span>
                  </div>
                  
                  <div class="flex flex-col min-w-0">
                    <div v-if="renamingClientId === client.id" class="flex items-center gap-2">
                      <input type="text" v-model="newClientName" @keyup.enter="submitRename(client.id)" @blur="submitRename(client.id)"
                             class="bg-black/60 border border-brand-primary/40 rounded-lg px-3 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-primary w-full"
                             v-focus>
                    </div>
                    <div v-else @click="startRename(client.id, client.config.name || client.host.name)" 
                         class="flex items-center gap-2 cursor-pointer group/name">
                      <span class="text-sm font-black text-white/80 truncate group-hover/name:text-white transition-colors">
                        {{ client.config.name || client.host.name || 'Unnamed Client' }}
                      </span>
                      <span class="material-symbols-outlined text-xs text-white/10 group-hover/name:text-brand-primary transition-colors">edit</span>
                    </div>
                    <span class="text-[9px] font-mono font-bold text-white/20 mt-0.5 tracking-tighter">{{ client.host.ip }} • {{ client.connected ? 'ONLINE' : 'OFFLINE' }}</span>
                  </div>
                </div>

                <!-- Vol Controls -->
                <div class="flex items-center gap-4">
                  <button @click="snapcastStore.setClientVolume(client.id, { percent: client.config.volume.percent, muted: !client.config.volume.muted })" 
                          class="p-2 rounded-xl transition-all border" 
                          :class="client.config.volume.muted ? 'bg-red-500/20 text-red-500 border-red-500/20' : 'bg-white/5 text-white/30 border-white/5 hover:text-white'">
                    <span class="material-symbols-outlined text-base">{{ client.config.volume.muted ? 'volume_off' : 'volume_up' }}</span>
                  </button>
                  
                  <div class="flex flex-col items-end gap-1.5">
                    <div class="relative w-24 sm:w-32 flex items-center">
                      <input type="range" class="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-brand-primary transition-all hover:bg-white/20" 
                             min="0" max="100" v-model="client.config.volume.percent" @change="updateVolume(client, $event)">
                    </div>
                    <span class="text-[10px] font-black" :class="client.config.volume.muted ? 'text-red-400' : 'text-white/60'">
                      {{ client.config.volume.muted ? 'MUTED' : client.config.volume.percent + '%' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="snapcastStore.loading" class="flex flex-col items-center justify-center py-24 text-white/20">
        <div class="w-12 h-12 border-4 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin mb-4"></div>
        <span class="text-xs font-black uppercase tracking-[0.3em]">Querying Network Infrastructure...</span>
      </div>
      <div v-else class="flex flex-col items-center justify-center py-24 text-white/10 glass rounded-[3rem]">
        <span class="material-symbols-outlined text-6xl mb-4">settings_input_component</span>
        <span class="text-xs font-black uppercase tracking-[0.3em]">No Snapserver Clusters Identified</span>
      </div>
    </div>
  </Layout>
</template>

<style scoped>
input[type=range]::-webkit-slider-thumb {
  height: 12px;
  width: 12px;
  border-radius: 50%;
  background: var(--brand-primary, #3b82f6);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
}
</style>
