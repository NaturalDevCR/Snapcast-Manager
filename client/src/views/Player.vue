<script setup lang="ts">
import Layout from '../components/Layout.vue';
import PlayerWidget from '../components/PlayerWidget.vue';
</script>

<template>
  <Layout>
    <div class="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-2xl mx-auto">
      <div class="flex items-center space-x-2 px-1 mb-8">
          <span class="material-symbols-outlined text-brand-primary text-2xl">music_note</span>
          <h1 class="text-2xl font-black text-white uppercase tracking-widest drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">Audio Player</h1>
      </div>
      
      <div class="shadow-2xl">
          <PlayerWidget />
      </div>
    </div>
  </Layout>
</template>
