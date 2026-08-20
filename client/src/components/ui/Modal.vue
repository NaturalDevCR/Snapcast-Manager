<script setup lang="ts">
// Modal.vue — Task 22 UI primitive.
//
// Structural pattern deliberately copied from the existing, already-proven
// ConfirmDialog.vue: Dialog/TransitionRoot/TransitionChild from
// @headlessui/vue, with the Dialog's own `@close` handler (fired on both
// Escape and an outside/backdrop click, per headlessui) wired straight to
// `update:modelValue(false)` — that single wire-up is what gives this
// component focus-trapping and Escape/backdrop dismissal "for free" exactly
// as ConfirmDialog.vue already relies on it. Not re-testing headlessui's own
// internals here, just that this component's own v-model integration doesn't
// break that behavior (see Modal.test.ts).
//
// Colors are token-only, unlike ConfirmDialog.vue's hardcoded
// `bg-slate-800`/`text-white`/`border-slate-700`/`text-slate-400` — this
// file does NOT copy those. The one deliberate exception is the backdrop
// scrim (`bg-black/50`): a modal backdrop's job is to dim whatever is
// behind it regardless of theme, the same category of justified
// theme-independent exception Toggle.vue documents for its knob color —
// there is no brand token for "screen scrim", and a token-driven scrim
// (e.g. brand-bg/80) would render as a near-invisible light haze in light
// mode instead of a backdrop.
import { computed } from 'vue';
import { Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue';
import { XMarkIcon } from '@heroicons/vue/24/outline';

export interface ModalProps {
  modelValue: boolean;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<ModalProps>(), {
  title: undefined,
  size: 'md',
});

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function close() {
  emit('update:modelValue', false);
}

const sizeClasses: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

const panelClasses = computed(() => [
  'relative transform overflow-hidden rounded-2xl bg-brand-surface border border-brand-primary/10 p-6 text-left text-text-main shadow-xl transition-all sm:my-8 sm:w-full',
  sizeClasses[props.size],
]);
</script>

<template>
  <TransitionRoot as="template" :show="modelValue">
    <Dialog as="div" class="relative z-50" @close="close">
      <TransitionChild
        as="template"
        enter="ease-out duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-200"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />
      </TransitionChild>

      <div class="fixed inset-0 z-10 overflow-y-auto">
        <div class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
          <TransitionChild
            as="template"
            enter="ease-out duration-300"
            enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            enter-to="opacity-100 translate-y-0 sm:scale-100"
            leave="ease-in duration-200"
            leave-from="opacity-100 translate-y-0 sm:scale-100"
            leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
          >
            <DialogPanel :class="panelClasses">
              <div class="flex items-start gap-3" :class="title ? 'mb-4' : 'mb-2'">
                <DialogTitle v-if="title" as="h3" class="text-lg font-black text-text-main pr-2">
                  {{ title }}
                </DialogTitle>
                <button
                  type="button"
                  class="ml-auto flex-shrink-0 rounded-lg p-1 text-text-muted hover:text-text-main hover:bg-brand-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                  aria-label="Close"
                  @click="close"
                >
                  <XMarkIcon class="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div class="text-sm text-text-muted">
                <slot />
              </div>

              <div v-if="$slots.footer" class="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                <slot name="footer" />
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>
