<script setup lang="ts">
// Select.vue — Task 21 UI primitive.
//
// Design decision: Listbox (from @headlessui/vue) over a native <select>.
// A native <select>'s open dropdown panel is rendered by the OS/browser and
// can't be restyled to match this app's glassmorphism/rounded-2xl/
// token-driven visual language (ConfirmDialog.vue and Card.vue establish
// that language elsewhere via Dialog/TransitionRoot, also from
// @headlessui/vue) — a native select would look visibly out of place next
// to the rest of the UI kit. Listbox is already a project dependency, gives
// correct keyboard (Up/Down/Home/End/typeahead) and ARIA
// (combobox/listbox/option roles, aria-selected, aria-activedescendant)
// behavior for free, and follows the same "lean on headlessui for
// interactive primitives" precedent Task 21's brief sets for Toggle and
// the existing Dialog-based components.
import { computed } from 'vue';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/vue';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/vue/24/outline';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectProps {
  modelValue?: string | number | null;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
}

const props = withDefaults(defineProps<SelectProps>(), {
  modelValue: null,
  disabled: false,
  placeholder: 'Select…',
});

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>();

const selected = computed(() => props.options.find((o) => o.value === props.modelValue));

function onUpdate(value: string | number) {
  emit('update:modelValue', value);
}
</script>

<template>
  <Listbox :model-value="modelValue" :disabled="disabled" @update:model-value="onUpdate">
    <div class="relative w-full">
      <ListboxButton
        class="relative w-full flex items-center justify-between py-3 px-4 bg-brand-bg border border-brand-primary/20 rounded-xl text-sm text-left font-medium text-text-main outline-none transition-all focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span :class="selected ? 'text-text-main' : 'text-text-muted'">
          {{ selected ? selected.label : placeholder }}
        </span>
        <ChevronUpDownIcon class="h-4 w-4 text-text-muted" aria-hidden="true" />
      </ListboxButton>
      <transition
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <ListboxOptions
          class="absolute z-20 mt-2 w-full max-h-60 overflow-auto rounded-xl bg-brand-surface border border-brand-primary/20 shadow-2xl shadow-brand-primary/10 py-1 text-sm outline-none"
        >
          <ListboxOption
            v-for="option in options"
            v-slot="{ active, selected: isSelected }"
            :key="option.value"
            :value="option.value"
            as="template"
          >
            <li
              :class="[
                'relative flex items-center justify-between cursor-pointer select-none py-2 px-4',
                active ? 'bg-brand-primary/10 text-brand-primary-text' : 'text-text-main',
              ]"
            >
              <span :class="isSelected ? 'font-bold' : 'font-medium'">{{ option.label }}</span>
              <CheckIcon v-if="isSelected" class="h-4 w-4 text-brand-primary" aria-hidden="true" />
            </li>
          </ListboxOption>
        </ListboxOptions>
      </transition>
    </div>
  </Listbox>
</template>
