<script setup lang="ts">
// Badge.vue — Task 21 UI primitive.
//
// Visual shape (rounded pill, bordered, uppercase, tracked-out, tiny bold
// text) matches the ad-hoc status pills already used across the app, e.g.
// Dashboard.vue's service-status pills (`px-2.5 py-1 rounded-lg text-[9px]
// border font-black uppercase tracking-widest`) and PipeSources.vue's
// type/status pills (`px-2 py-0.5 rounded-full text-[10px] font-semibold`).
//
// `success`/`warning`/`danger` use Tailwind's semantic emerald/amber/red
// palette rather than brand tokens, matching how those exact colors are
// already used throughout the app for status (Dashboard.vue's
// `bg-success` "playing"/active dot, PipeSources.vue's
// `bg-green-500`/`bg-red-500`/`bg-yellow-500` statusColor() map,
// ConfirmDialog's amber/red icon backgrounds) — none of these are part of
// the brand's purple/teal palette, so they're the brief's justified
// "semantic status color" exception. `neutral` and `brand` are fully
// token-driven (text-text-muted/brand-surface and text-brand-primary-text
// respectively) — `brand` replaces the ad-hoc `purple-500`/`purple-300`
// literal used for PipeSources.vue's "Radio" pipe-type pill with the real
// brand-primary-text token. (`text-brand-primary-text`, not
// `text-brand-primary` itself, per the Task 37 review fix — see
// client/src/style.css's `--brand-primary-text` comment: `--brand-primary`
// as TEXT fails AA in one theme or the other, so the text-specific token
// carries separate light/dark values.)
import { computed } from 'vue';

export interface BadgeProps {
  variant?: 'success' | 'warning' | 'danger' | 'neutral' | 'brand';
  size?: 'sm' | 'md';
}

const props = withDefaults(defineProps<BadgeProps>(), {
  variant: 'neutral',
  size: 'md',
});

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  success: 'text-success bg-success/10 border-success/20',
  warning: 'text-warning bg-warning/10 border-warning/20',
  danger: 'text-danger bg-danger/10 border-danger/20',
  neutral: 'text-text-muted bg-inset border-line',
  brand: 'text-brand-primary-text bg-brand-primary/10 border-brand-primary/20',
};

const sizeClasses: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-[11px]',
};

const classes = computed(() => [
  'inline-flex items-center justify-center gap-1 rounded-md border font-bold uppercase tracking-wider whitespace-nowrap',
  variantClasses[props.variant],
  sizeClasses[props.size],
]);
</script>

<template>
  <span :class="classes"><slot /></span>
</template>
