<script setup lang="ts">
// Button.vue — Task 21 UI primitive.
//
// A real <button> (not a styled <div>) so native keyboard/focus behavior
// (Space/Enter activation, disabled state, tab order) is free. Variants and
// sizes are plain class maps rather than a CSS framework abstraction, to
// stay consistent with how the rest of this app authors Tailwind classes
// directly in templates.
//
// Color: every variant except `danger` is driven entirely by design tokens
// (brand-primary / text-main / text-muted / brand-surface). `danger` uses
// Tailwind's semantic `red-*` palette rather than a brand token — destructive
// actions intentionally do NOT use the brand purple/teal, matching
// ConfirmDialog.vue's existing red-for-danger convention. `text-white` is
// used on the three solid-background variants (primary/danger) — this
// mirrors Login.vue's existing submit-button pattern (`bg-brand-primary ...
// text-white`) and is safe across themes because those backgrounds resolve
// to the same fixed brand-primary/red hex in both light and dark mode (see
// client/src/style.css's :root/.dark blocks), so white text always has
// sufficient contrast against them — it isn't standing in for a themed
// surface color.
import { computed } from 'vue';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  type: 'button',
});

defineEmits<{ click: [MouseEvent] }>();

const isDisabled = computed(() => props.disabled || props.loading);

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-brand-primary hover:bg-brand-primary/80 text-white border border-brand-primary/50 shadow-lg shadow-brand-primary/20',
  secondary:
    'bg-transparent hover:bg-brand-primary/10 text-brand-primary-text border border-brand-primary/40',
  danger:
    'bg-red-600 hover:bg-red-500 text-white border border-red-500/50 shadow-lg shadow-red-500/20',
  ghost: 'bg-transparent hover:bg-brand-primary/10 text-text-main border border-transparent',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2.5',
};

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-xl font-black uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
  variantClasses[props.variant],
  sizeClasses[props.size],
]);
</script>

<template>
  <button :type="type" :disabled="isDisabled" :class="classes" @click="$emit('click', $event)">
    <span
      v-if="loading"
      class="material-symbols-outlined animate-spin text-[1.1em] leading-none"
      aria-hidden="true"
      >sync</span
    >
    <slot />
  </button>
</template>
