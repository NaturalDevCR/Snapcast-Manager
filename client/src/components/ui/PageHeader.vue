<script setup lang="ts">
// PageHeader.vue -- UI overhaul (2026-11) primitive.
//
// Every view used to hand-roll its own header: Dashboard a 3xl white title,
// Pipe Sources a purple gradient title, Watchdogs a blue one, Routing an
// icon tile with an uppercase tracked-out subtitle, etc. -- so the app read
// as a collection of unrelated pages. This is the one header every
// top-level view now uses: title (+ optional status badge slot), one-line
// description, and right-aligned actions that wrap below on phones.
export interface PageHeaderProps {
  title: string;
  description?: string;
}

withDefaults(defineProps<PageHeaderProps>(), {
  description: undefined,
});
</script>

<template>
  <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
    <div class="min-w-0">
      <div class="flex items-center gap-2.5 flex-wrap">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-text-main">{{ title }}</h1>
        <slot name="badge" />
      </div>
      <p v-if="description" class="text-sm text-text-muted mt-1 max-w-2xl">{{ description }}</p>
    </div>
    <div
      v-if="$slots.actions"
      class="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
