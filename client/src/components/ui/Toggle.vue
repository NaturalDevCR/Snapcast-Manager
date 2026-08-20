<script setup lang="ts">
// Toggle.vue — Task 21 UI primitive.
//
// Uses Switch (from @headlessui/vue) rather than hand-rolling a
// checkbox-styled-as-a-switch, matching the brief's precedent for leaning
// on already-available accessible primitives. It supplies role="switch"
// and aria-checked for free.
//
// The knob (`bg-white`) is the one intentionally-literal color in this
// file: switch knobs are a near-universal convention of being a plain
// white circle regardless of the surrounding track color or the app's
// theme (iOS/Android/most web design systems all do this), because it
// needs to contrast against BOTH the on-state (brand-primary) and
// off-state (brand-surface-ish) track colors, in both light and dark mode.
// No design token in this app's palette resolves to a fixed "always
// white" — brand-surface itself flips between white and near-black across
// themes — so token-driving the knob would break contrast in one theme or
// the other. This is the same category of exception the brief calls out
// for semantic error-red/warning-amber: a deliberate, justified departure
// from token-only color for a genuinely theme-independent UI convention.
import { computed } from 'vue';
import { Switch } from '@headlessui/vue';

export interface ToggleProps {
  modelValue: boolean;
  disabled?: boolean;
  label?: string;
}

const props = withDefaults(defineProps<ToggleProps>(), {
  disabled: false,
  label: undefined,
});

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const trackClasses = computed(() => [
  'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 disabled:opacity-50 disabled:cursor-not-allowed',
  props.modelValue
    ? 'bg-brand-primary border-brand-primary'
    : 'bg-brand-bg border-brand-primary/30',
]);

const knobClasses = computed(() => [
  'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
  props.modelValue ? 'translate-x-6' : 'translate-x-1',
]);
</script>

<template>
  <label class="inline-flex items-center gap-3" :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'">
    <Switch
      :model-value="modelValue"
      :disabled="disabled"
      :class="trackClasses"
      @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    >
      <span class="sr-only">{{ label || 'Toggle' }}</span>
      <span :class="knobClasses" />
    </Switch>
    <span v-if="label" class="text-sm font-medium text-text-main">{{ label }}</span>
  </label>
</template>
