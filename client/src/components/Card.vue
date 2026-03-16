<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="bg-[#2a1c31]/60 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 hover:border-brand-primary/30 group">
    <div v-if="title || $slots.title" class="px-6 py-5 border-b border-white/5 bg-black/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div v-if="$slots.icon" class="flex items-center justify-center text-brand-primary bg-brand-primary/10 w-8 h-8 rounded-lg border border-brand-primary/20">
            <slot name="icon"></slot>
        </div>
        <h3 v-if="title" class="text-sm font-bold text-white tracking-widest uppercase">{{ title }}</h3>
        <slot v-else name="title"></slot>
      </div>
      <slot name="action"></slot>
    </div>
    <div class="p-6">
      <slot></slot>
    </div>
  </div>
</template>
