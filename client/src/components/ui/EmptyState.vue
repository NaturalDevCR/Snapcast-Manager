<script setup lang="ts">
// EmptyState.vue — Task 22 UI primitive.
//
// Extracts the "no data yet" pattern that already existed ad hoc, pre-token,
// in a couple of views — e.g. PipeSources.vue's
// `<span class="material-symbols-outlined text-4xl text-zinc-700 mb-3
// block">sensors</span><p class="text-zinc-500">No pipe sources
// configured.</p>` and ClientDashboard.vue's `text-white/20` "No instances
// configured" block — into a token-driven, reusable component matching that
// same visual language (large muted icon, bold/black title, centered).
// Rebuilt on `text-text-muted` instead of those files' literal
// `zinc-700`/`zinc-500`/`white/20`.
//
// The action slot is explicitly named (not the default slot) so this stays
// a single-purpose "icon + title + description" component with one clearly
// documented extension point, matching Modal.vue's `footer` naming
// convention — this is the "vacío (con acción)" case the design spec calls
// out, e.g. an "Add your first pipe source" CTA using Button.vue.
export interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
}

withDefaults(defineProps<EmptyStateProps>(), {
  description: undefined,
});
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center py-12 px-6">
    <span class="material-symbols-outlined text-4xl text-text-muted/50 mb-3" aria-hidden="true">{{ icon }}</span>
    <h3 class="text-sm font-black text-text-main uppercase tracking-widest">{{ title }}</h3>
    <p v-if="description" class="text-sm text-text-muted mt-2 max-w-sm">{{ description }}</p>
    <div v-if="$slots.action" class="mt-6">
      <slot name="action" />
    </div>
  </div>
</template>
