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
             class="bg-brand-surface/60 backdrop-blur-3xl border border-white/5 rounded-[2rem] shadow-xl transition-all duration-500 hover:border-brand-primary/30 hover:shadow-brand-primary/20 hover:-translate-y-1 group/card relative flex flex-col">
          
          <!-- Card Header (Zone & Stream) -->
          <div class="p-6 sm:p-8 flex-shrink-0 relative z-10">
            <!-- Glow background -->
            <div class="absolute -inset-4 bg-brand-primary/5 blur-3xl rounded-[3rem] opacity-0 group-hover/card:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
            
            <div class="flex items-center justify-between mb-8 relative z-10">
              <div class="flex items-center gap-4">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-primary/20 to-brand-primary/5 flex items-center justify-center text-brand-primary border border-brand-primary/20 group-hover/card:scale-105 transition-all duration-500 shadow-inner">
                  <span class="material-symbols-outlined text-2xl">speaker_group</span>
                </div>
                <div>
                  <h3 class="text-2xl font-bold text-text-main tracking-tight">{{ group.name || 'Zone ' + group.id.slice(0,4) }}</h3>
                  <p class="text-xs font-semibold text-text-muted mt-1 uppercase tracking-wider">{{ group.clients.length }} TARGET DESTINATIONS</p>
                </div>
              </div>
              <button @click="snapcastStore.setGroupMute(group.id, !group.muted)" 
                      class="w-12 h-12 rounded-2xl transition-all duration-300 border flex items-center justify-center group/mute shadow-md hover:shadow-lg"
                      :class="group.muted ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20' : 'bg-brand-surface text-text-muted border-white/5 hover:text-text-main hover:border-white/10'">
                <span class="material-symbols-outlined transition-transform group-hover/mute:scale-110">{{ group.muted ? 'volume_off' : 'volume_up' }}</span>
              </button>
            </div>

            <!-- Stream Selector Chips -->
            <div class="space-y-3 relative z-10">
              <label class="text-xs font-semibold text-text-muted uppercase tracking-wider px-1">Source Stream</label>
              <div class="flex flex-wrap gap-2">
                <button v-for="stream in snapcastStore.status.streams" :key="stream.id"
                        @click="snapcastStore.setGroupStream(group.id, stream.id)"
                        class="px-4 py-2.5 rounded-xl text-xs font-medium transition-all duration-300 relative overflow-hidden flex items-center gap-2 border"
                        :class="group.stream_id === stream.id 
                          ? 'border-brand-primary/50 bg-brand-primary/10 text-brand-primary shadow-sm shadow-brand-primary/10' 
                          : 'border-white/5 bg-brand-surface hover:bg-white/5 text-text-muted hover:text-text-main'">
                  <div class="w-2 h-2 rounded-full" :class="stream.status === 'playing' ? 'bg-[#10b981] animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-text-muted/50'"></div>
                  {{ getStreamLabel(stream) }}
                </button>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div class="h-px w-full bg-gradient-to-r from-transparent via-white/5 to-transparent"></div>

          <!-- Clients List -->
          <div class="p-6 sm:p-8 space-y-3 flex-grow bg-black/5 rounded-b-[2rem] relative z-10 box-border border-t border-white/[0.02]">
            <div class="flex items-center justify-between px-2 mb-2">
              <span class="text-xs font-semibold text-text-muted uppercase tracking-wider">Destination Nodes</span>
              <span class="text-xs font-semibold text-brand-primary uppercase tracking-wider">Volume</span>
            </div>

            <div v-for="client in group.clients" :key="client.id" 
                 class="p-4 sm:p-5 rounded-2xl bg-brand-surface border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300 group/client shadow-sm hover:shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                 
                 <!-- Left: Icon & Name -->
                 <div class="flex items-center gap-4 w-full sm:w-auto min-w-0">
                  <div class="w-12 h-12 flex-shrink-0 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-white/5 flex items-center justify-center transition-colors duration-300"
                        :class="client.connected ? 'text-brand-primary group-hover/client:text-brand-primary/80' : 'text-text-muted'">
                    <span class="material-symbols-outlined">{{ client.config.name ? 'speaker' : 'smartphone' }}</span>
                  </div>
                  
                  <div class="flex flex-col min-w-0 flex-grow">
                    <div v-if="renamingClientId === client.id" class="flex items-center gap-2">
                      <input type="text" v-model="newClientName" @keyup.enter="submitRename(client.id)" @blur="submitRename(client.id)"
                             class="bg-brand-surface border border-brand-primary/50 outline-none rounded-lg px-3 py-1.5 text-sm text-text-main focus:ring-2 focus:ring-brand-primary/30 w-full transition-all"
                             v-focus>
                    </div>
                    <div v-else @click="startRename(client.id, client.config.name || client.host.name)" 
                         class="flex items-center gap-2 cursor-pointer group/name w-full">
                       <span class="text-base font-semibold text-text-main truncate group-hover/name:text-brand-primary transition-colors">
                        {{ client.config.name || client.host.name || 'Unnamed Client' }}
                      </span>
                      <span class="material-symbols-outlined text-sm text-text-muted opacity-0 group-hover/name:opacity-100 transition-all">edit</span>
                    </div>
                    <div class="flex items-center gap-2 mt-1">
                        <div class="w-1.5 h-1.5 rounded-full" :class="client.connected ? 'bg-[#10b981]' : 'bg-red-500'"></div>
                        <span class="text-xs font-medium text-text-muted truncate">{{ client.host.ip }}</span>
                    </div>
                  </div>
                 </div>

                 <!-- Right: Volume Controls -->
                 <div class="flex items-center gap-3 sm:gap-4 w-full sm:w-auto shrink-0 justify-end sm:justify-start">
                  <!-- Mute Button -->
                  <button @click="snapcastStore.setClientVolume(client.id, { percent: client.config.volume.percent, muted: !client.config.volume.muted })" 
                          class="p-2 sm:p-2.5 rounded-xl transition-all hover:bg-white/5 border border-transparent"
                          :class="client.config.volume.muted ? 'text-red-400 bg-red-400/10 border-red-400/20' : 'text-text-muted hover:text-text-main hover:border-white/10'">
                    <span class="material-symbols-outlined text-[20px]">{{ client.config.volume.muted ? 'volume_off' : 'volume_up' }}</span>
                  </button>
                  
                  <!-- Volume Slider & Value -->
                  <div class="flex items-center gap-3">
                    <div class="w-24 sm:w-28 relative flex items-center group/slider">
                      <input type="range" class="w-full h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-brand-primary transition-all group-hover/slider:bg-white/20" 
                             min="0" max="100" v-model="client.config.volume.percent" @change="updateVolume(client, $event)">
                    </div>
                    <div class="w-10 text-right">
                        <span class="text-xs font-bold" :class="client.config.volume.muted ? 'text-red-400' : 'text-text-muted'">
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
