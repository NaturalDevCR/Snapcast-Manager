<script setup lang="ts">
// Skeleton.vue — Task 22 UI primitive.
//
// `animate-pulse` is Tailwind's built-in shimmer keyframe (opacity 1 <->
// 0.5) — zero-dependency, and this app has no prior shimmer/skeleton
// precedent to match (grepped for `animate-pulse`: every existing use is an
// unrelated "live" status dot/pulse, e.g. Dashboard.vue's emerald "playing"
// dot, not a loading placeholder), so this introduces the pattern fresh
// rather than matching an established one.
//
// prefers-reduced-motion: style.css's Task 20 global override collapses
// `animation-duration`/`transition-duration` to 0.01ms for `*, *::before,
// *::after` under `@media (prefers-reduced-motion: reduce)`, with a single
// carve-out that RE-ENABLES only `.animate-spin`. That carve-out is scoped
// to the `.animate-spin` class selector alone, so it does NOT also catch
// `.animate-pulse` — confirmed by reading the selector list in
// client/src/style.css. That's the correct outcome here: a spinner
// communicates "still working" and freezing it would look hung, but a
// pulsing skeleton isn't essential to keep animating, so it SHOULD be
// dampened to near-static for reduced-motion users, and the existing
// blanket rule already does that with no changes needed in this file.
import { computed } from 'vue';

export interface SkeletonProps {
  variant?: 'text' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
}

const props = withDefaults(defineProps<SkeletonProps>(), {
  variant: 'text',
  width: undefined,
  height: undefined,
});

const variantClasses: Record<NonNullable<SkeletonProps['variant']>, string> = {
  text: 'rounded-md h-4 w-full',
  circle: 'rounded-full h-10 w-10',
  rect: 'rounded-xl h-24 w-full',
};

function toCssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

const style = computed(() => ({
  width: toCssSize(props.width),
  height: toCssSize(props.height),
}));

const classes = computed(() => ['animate-pulse bg-brand-primary/10', variantClasses[props.variant]]);
</script>

<template>
  <div :class="classes" :style="style" role="presentation" aria-hidden="true" />
</template>
