<script setup lang="ts">
// Card.vue -- generic content panel.
//
// UI overhaul (2026-11): this used to carry a hover glow + icon scale on
// every card, which made static, non-clickable panels look interactive, and
// its header stacked vertically below `sm`, pushing action buttons (e.g. the
// health panel's refresh) onto their own line under the title on phones.
// The header now always stays a single row, and `subtitle` gives a slot for
// a one-line description without each view hand-rolling one.
defineProps<{
  title?: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="bg-brand-surface/80 backdrop-blur-xl border border-line rounded-2xl shadow-sm relative overflow-hidden flex flex-col">
    <div v-if="title || $slots.title" class="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <div v-if="$slots.icon" class="flex items-center justify-center text-brand-primary-text bg-brand-primary/10 w-9 h-9 rounded-xl flex-shrink-0">
          <slot name="icon"></slot>
        </div>
        <div class="min-w-0">
          <h3 v-if="title" class="text-sm font-bold text-text-main truncate">{{ title }}</h3>
          <slot v-else name="title"></slot>
          <p v-if="subtitle" class="text-xs text-text-muted truncate">{{ subtitle }}</p>
        </div>
      </div>
      <div v-if="$slots.action" class="flex items-center gap-2 flex-shrink-0">
        <slot name="action"></slot>
      </div>
    </div>

    <div class="p-5 flex-1 flex flex-col min-h-0">
      <slot></slot>
    </div>
  </div>
</template>
