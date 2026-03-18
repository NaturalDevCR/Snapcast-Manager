<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="bg-brand-surface/40 backdrop-blur-3xl border border-white/[0.03] rounded-[2rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-500 hover:border-brand-primary/40 hover:shadow-brand-primary/5 group relative">
    <!-- Subtle Gradient Overlay -->
    <div class="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none"></div>
    
    <div v-if="title || $slots.title" class="px-7 py-5 border-b border-white/[0.03] bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
      <div class="flex items-center gap-4">
        <div v-if="$slots.icon" class="flex items-center justify-center text-brand-primary bg-brand-primary/10 w-10 h-10 rounded-2xl border border-brand-primary/20 shadow-[0_0_15px_rgba(166,13,242,0.15)] group-hover:shadow-[0_0_20px_rgba(166,13,242,0.3)] transition-all duration-500">
            <slot name="icon"></slot>
        </div>
        <div>
            <h3 v-if="title" class="text-xs font-black text-white/90 tracking-[0.2em] uppercase">{{ title }}</h3>
            <slot v-else name="title"></slot>
        </div>
      </div>
      <div class="flex items-center gap-2">
          <slot name="action"></slot>
      </div>
    </div>
    
    <div class="p-7 relative z-10">
      <slot></slot>
    </div>
  </div>
</template>
