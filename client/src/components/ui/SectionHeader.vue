<script setup lang="ts">
// SectionHeader.vue — Task 22 UI primitive.
//
// Extracts the "uppercase tracked-out section label" pattern already used
// ad hoc, token-driven, across the app — e.g. Dashboard.vue's
// `<h2 class="text-sm font-bold text-text-main uppercase
// tracking-widest">Core System Services</h2>` (also this task's own
// UiKit.vue section headers) — verbatim as the `title`'s classes, rather
// than inventing a new type scale, so this is a drop-in replacement
// candidate for that exact markup in later view-decomposition work.
//
// `eyebrow` matches the smaller/denser tracked-out label pattern seen above
// titles elsewhere (e.g. Dashboard.vue's `text-[10px] font-black
// text-text-muted uppercase tracking-[0.4em]` "Live Infrastructure
// Metrics" label) — no exact "eyebrow directly above a title" precedent
// exists in this app, so this reuses that same small-label styling in the
// closest-matching position rather than inventing a new one.
//
// `description` intentionally overrides the title's uppercase/tracking
// (`normal-case tracking-normal`) since descriptive prose reads better in
// sentence case — matching how Dashboard.vue's own error description under
// an uppercase `<h3>` (`<p class="text-xs text-text-muted ...">`) is plain
// sentence-case text, not tracked/uppercase.
export interface SectionHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
}

withDefaults(defineProps<SectionHeaderProps>(), {
  description: undefined,
  eyebrow: undefined,
});
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div>
      <p v-if="eyebrow" class="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-1">
        {{ eyebrow }}
      </p>
      <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">{{ title }}</h2>
      <p v-if="description" class="text-xs text-text-muted normal-case tracking-normal font-medium mt-1.5">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.action" class="flex-shrink-0">
      <slot name="action" />
    </div>
  </div>
</template>
