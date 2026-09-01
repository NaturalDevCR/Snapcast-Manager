<script setup lang="ts">
// Input.vue — Task 21 UI primitive.
//
// Visual style matches Login.vue's established input markup (rounded-xl,
// bordered, focus ring in brand-primary) but is rebuilt on tokens only:
// Login.vue's `bg-black/20 border-black/10 dark:border-white/10` is a literal black/white
// overlay that predates the token system and is explicitly disallowed in
// this file's color palette, so this uses `bg-brand-bg` (the token for the
// page's sunken background) against the surrounding `bg-brand-surface`
// card, plus a brand-tinted border — giving the same "recessed field on a
// glass card" look in both themes without any literal slate/gray/white/
// black class.
//
// Error state uses Tailwind's semantic `red-*` palette rather than a brand
// token, matching the app's existing convention of red for
// failed/errored/destructive states (see PipeSources.vue's statusColor()
// and ConfirmDialog.vue's danger styling) — this app's brand purple isn't
// a semantic "something is wrong" color.
import { computed, useId } from 'vue';

export interface InputProps {
  modelValue?: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  label?: string;
}

withDefaults(defineProps<InputProps>(), {
  modelValue: '',
  type: 'text',
  placeholder: undefined,
  disabled: false,
  error: undefined,
  label: undefined,
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const generatedId = useId();
const inputId = computed(() => `input-${generatedId}`);
const errorId = computed(() => `${inputId.value}-error`);

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="w-full">
    <label
      v-if="label"
      :for="inputId"
      class="block text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5"
    >
      {{ label }}
    </label>
    <div class="relative">
      <div v-if="$slots.icon" class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <slot name="icon" />
      </div>
      <input
        :id="inputId"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errorId : undefined"
        :class="[
          'block w-full py-3 bg-brand-bg border rounded-xl text-sm text-text-main placeholder-text-muted outline-none transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed',
          $slots.icon ? 'pl-11 pr-4' : 'px-4',
          error
            ? 'border-red-500 focus:ring-2 focus:ring-red-500/40 focus:border-red-500'
            : 'border-brand-primary/20 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50',
        ]"
        @input="onInput"
      />
    </div>
    <p v-if="error" :id="errorId" class="mt-1.5 text-xs text-red-500 font-medium">
      {{ error }}
    </p>
  </div>
</template>
