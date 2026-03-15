<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300">
    <div v-if="title || $slots.title" class="px-6 py-4 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-800/10 flex items-center">
      <div v-if="$slots.icon" class="mr-3">
          <slot name="icon"></slot>
      </div>
      <h3 v-if="title" class="text-sm font-bold text-slate-800 dark:text-slate-100 tracking-tight uppercase">{{ title }}</h3>
      <slot v-else name="title"></slot>
    </div>
    <div class="p-6">
      <slot></slot>
    </div>
  </div>
</template>
