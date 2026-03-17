<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { useMpdStore } from '../stores/mpd';

const mpdStore = useMpdStore();
let pollInterval: number | undefined;

onMounted(() => {
  mpdStore.fetchStatus();
  // Poll status every 3 seconds
  pollInterval = window.setInterval(() => {
    mpdStore.fetchStatus();
  }, 3000);
});

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
});

const isPlaying = computed(() => mpdStore.status?.state === 'play');
const hasSong = computed(() => mpdStore.status?.currentSong && (mpdStore.status.currentSong.title || mpdStore.status.currentSong.file));

const progress = computed(() => {
  if (!mpdStore.status?.elapsed || !mpdStore.status?.duration) return 0;
  const elapsed = parseFloat(mpdStore.status.elapsed);
  const duration = parseFloat(mpdStore.status.duration);
  if (isNaN(elapsed) || isNaN(duration) || duration === 0) return 0;
  return (elapsed / duration) * 100;
});

const formatTime = (secondsStr: string) => {
  const secs = parseFloat(secondsStr);
  if (isNaN(secs)) return '--:--';
  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
};

const handleControl = async (action: 'play' | 'pause' | 'stop' | 'next' | 'previous') => {
  try {
    await mpdStore.control(action);
  } catch (err: any) {
    console.error('Failed to control MPD:', err);
  }
};
</script>

<template>
  <div class="bg-[#2a1c31]/60 backdrop-blur-xl border border-white/5 rounded-3xl p-6 shadow-2xl overflow-hidden relative group hover:border-brand-primary/20 transition-all duration-500">
    <div class="absolute -inset-0.5 bg-gradient-to-r from-brand-primary/20 to-purple-500/20 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity blur-xl -z-10"></div>
    
    <div class="flex flex-col h-full justify-between space-y-4">
      <!-- Top header / Status -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="material-symbols-outlined text-brand-primary" :class="{'animate-spin duration-1000': isPlaying}">audiotrack</span>
          <span class="text-xs font-black text-gray-400 uppercase tracking-widest">Audio Player</span>
        </div>
        <div class="px-3 py-1 bg-black/40 rounded-full border border-white/5 flex items-center space-x-1">
            <span class="relative flex h-2 w-2" v-if="isPlaying">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ff9d] opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-[#00ff9d]"></span>
            </span>
            <span v-else class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
            <span class="text-[9px] font-black uppercase tracking-widest text-gray-300">{{ mpdStore.status?.state || 'stopped' }}</span>
        </div>
      </div>

      <!-- Main Info Row -->
      <div class="flex items-center space-x-4">
        <!-- CD/Album Cover Placeholder con Rotación -->
        <div class="w-16 h-16 rounded-full bg-gradient-to-br from-brand-primary to-[#8e0bc9] flex items-center justify-center flex-shrink-0 shadow-lg relative border-2 border-white/10 group-hover:scale-105 transition-transform duration-500"
             :class="{'animate-[spin_4s_linear_infinite]': isPlaying}">
            <span class="material-symbols-outlined text-3xl text-white drop-shadow-md">music_note</span>
            <div class="absolute inset-0 rounded-full bg-black/20 mix-blend-overlay"></div>
            <!-- Center hole for vinyl look -->
            <div class="absolute w-3 h-3 bg-[#13071b] rounded-full border border-white/10"></div>
        </div>

        <div class="flex-grow min-w-0">
          <h3 class="text-lg font-black text-white truncate drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">
              {{ hasSong ? mpdStore.status?.currentSong.title : 'No Track Playing' }}
          </h3>
          <p class="text-xs font-semibold text-gray-400 truncate">
              {{ hasSong ? mpdStore.status?.currentSong.artist : 'Music Player Daemon' }}
          </p>
        </div>
      </div>

      <!-- Controls and Bar -->
      <div class="space-y-3">
        <!-- Progress Bar -->
        <div class="space-y-1">
          <div class="h-1 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <div class="h-full bg-gradient-to-r from-brand-primary to-[#8e0bc9] rounded-full shadow-[0_0_10px_rgba(166,13,242,0.6)] transition-all duration-300" 
                   :style="{ width: progress + '%' }"></div>
          </div>
          <div class="flex justify-between text-[10px] font-bold text-gray-500 font-mono">
              <span>{{ formatTime(mpdStore.status?.elapsed || '0') }}</span>
              <span>{{ formatTime(mpdStore.status?.duration || '0') }}</span>
          </div>
        </div>

        <!-- Controls -->
        <div class="flex items-center justify-center space-x-4">
          <button @click="handleControl('previous')" class="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-95 disabled:opacity-50" :disabled="mpdStore.loading">
              <span class="material-symbols-outlined text-lg">skip_previous</span>
          </button>
          
          <button @click="handleControl(isPlaying ? 'pause' : 'play')" class="w-11 h-11 bg-white hover:bg-gray-100 text-[#13071b] rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50" :disabled="mpdStore.loading">
              <span class="material-symbols-outlined text-xl">{{ isPlaying ? 'pause' : 'play_arrow' }}</span>
          </button>

          <button @click="handleControl('next')" class="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-95 disabled:opacity-50" :disabled="mpdStore.loading">
              <span class="material-symbols-outlined text-lg">skip_next</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
