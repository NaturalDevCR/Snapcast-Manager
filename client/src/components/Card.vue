<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="bg-brand-surface border border-white/10 rounded-xl shadow-sm transition-all duration-300 hover:border-brand-primary/50 relative overflow-hidden group">
    
    <div v-if="title || $slots.title" class="px-4 py-3 border-b border-white/5 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
      <div class="flex items-center gap-3">
        <div v-if="$slots.icon" class="flex items-center justify-center text-brand-primary bg-brand-primary/10 w-8 h-8 rounded-lg border border-brand-primary/20 transition-all duration-300">
            <slot name="icon"></slot>
        </div>
        <div>
            <h3 v-if="title" class="text-xs font-semibold text-white/90 tracking-wide">{{ title }}</h3>
            <slot v-else name="title"></slot>
        </div>
      </div>
      <div class="flex items-center gap-2">
          <slot name="action"></slot>
      </div>
    </div>
    
    <div class="p-4 sm:p-5 relative z-10">
      <slot></slot>
    </div>
  </div>
</template>
