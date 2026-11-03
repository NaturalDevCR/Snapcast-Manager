<script setup lang="ts">
// StatTile.vue -- UI overhaul (2026-11). One "at a glance" status figure on
// the Dashboard's top row (snapserver state, streams, clients, diagnostics).
// Renders as a router-link when `to` is set so the tile itself is the path
// to the page that explains/fixes what it shows; otherwise a plain block.
import { computed } from 'vue';

export type StatTone = 'success' | 'warning' | 'danger' | 'neutral';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string;
    detail?: string;
    icon: string;
    tone?: StatTone;
    to?: string;
  }>(),
  { detail: undefined, tone: 'neutral', to: undefined },
);

const dotClass = computed(
  () =>
    ({
      success: 'bg-success',
      warning: 'bg-warning',
      danger: 'bg-danger',
      neutral: 'bg-text-muted/50',
    })[props.tone],
);

const valueClass = computed(
  () =>
    ({
      success: 'text-text-main',
      warning: 'text-warning',
      danger: 'text-danger',
      neutral: 'text-text-main',
    })[props.tone],
);
</script>

<template>
  <component
    :is="to ? 'router-link' : 'div'"
    :to="to"
    class="group relative flex flex-col gap-3 rounded-2xl border border-line bg-brand-surface/80 p-4 shadow-sm"
    :class="to ? 'hover:border-brand-primary/40 hover:bg-brand-surface transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50' : ''"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-2 text-xs font-medium text-text-muted">
        <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">{{ icon }}</span>
        {{ label }}
      </span>
      <span
        v-if="to"
        class="material-symbols-outlined text-[1rem] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
        aria-hidden="true"
      >arrow_forward</span>
    </div>
    <div class="flex items-start gap-2 min-w-0">
      <span class="w-2 h-2 mt-2 rounded-full flex-shrink-0" :class="dotClass" aria-hidden="true"></span>
      <span class="text-base sm:text-lg font-semibold leading-tight line-clamp-2" :class="valueClass">{{ value }}</span>
    </div>
    <p v-if="detail" class="-mt-2 text-xs text-text-muted truncate">{{ detail }}</p>
  </component>
</template>
