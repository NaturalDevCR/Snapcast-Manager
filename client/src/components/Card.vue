<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="bg-brand-surface/80 backdrop-blur-3xl border border-white/[0.04] rounded-[2rem] shadow-2xl transition-all duration-500 hover:border-brand-primary/40 hover:shadow-brand-primary/20 relative overflow-hidden group">
    
    <div v-if="title || $slots.title" class="px-6 py-5 border-b border-white/[0.04] bg-white/[0.01] flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
      <div class="flex items-center gap-4">
        <div v-if="$slots.icon" class="flex items-center justify-center text-brand-primary bg-brand-primary/10 w-12 h-12 rounded-2xl border border-brand-primary/20 shadow-lg shadow-brand-primary/10 group-hover:scale-110 group-hover:shadow-brand-primary/30 transition-all duration-500">
            <slot name="icon"></slot>
        </div>
        <div>
            <h3 v-if="title" class="text-sm font-black text-white tracking-wide">{{ title }}</h3>
            <slot v-else name="title"></slot>
        </div>
      </div>
      <div class="flex items-center gap-2">
          <slot name="action"></slot>
      </div>
    </div>
    
    <div class="p-6 sm:p-8 relative z-10">
      <slot></slot>
    </div>
  </div>
</template>
