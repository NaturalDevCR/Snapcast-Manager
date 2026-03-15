<template>
  <TransitionRoot as="template" :show="modelValue">
    <Dialog as="div" class="relative z-50" @close="$emit('update:modelValue', false)">
      <TransitionChild
        as="template"
        enter="ease-out duration-300"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-200"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-slate-900/75 backdrop-blur-sm transition-opacity" />
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
            <DialogPanel class="relative transform overflow-hidden rounded-2xl bg-slate-800 border border-slate-700 p-6 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
              <div class="sm:flex sm:items-start">
                <div class="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary-900/30 text-primary-500 sm:mx-0 sm:h-10 sm:w-10">
                  <PencilSquareIcon class="h-6 w-6" aria-hidden="true" />
                </div>
                <div class="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left w-full">
                  <DialogTitle as="h3" class="text-lg font-semibold leading-6 text-white">
                    {{ title }}
                  </DialogTitle>
                  <div class="mt-2">
                    <p class="text-sm text-slate-400 mb-4">
                      {{ message }}
                    </p>
                    <input
                      ref="inputRef"
                      v-model="inputValue"
                      type="text"
                      class="block w-full rounded-xl border-0 py-2.5 bg-slate-900 text-white shadow-sm ring-1 ring-inset ring-slate-700 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-primary-500 sm:text-sm sm:leading-6"
                      :placeholder="placeholder"
                      @keyup.enter="confirm"
                    />
                  </div>
                </div>
              </div>
              <div class="mt-6 sm:mt-6 sm:flex sm:flex-row-reverse gap-3">
                <button
                  type="button"
                  class="inline-flex w-full justify-center rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 sm:w-auto transition-all"
                  :disabled="!inputValue"
                  @click="confirm"
                >
                  {{ confirmText }}
                </button>
                <button
                  type="button"
                  class="mt-3 inline-flex w-full justify-center rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-slate-600 hover:bg-slate-600 sm:mt-0 sm:w-auto transition-all"
                  @click="$emit('update:modelValue', false)"
                >
                  {{ cancelText }}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { Dialog, DialogPanel, DialogTitle, TransitionChild, TransitionRoot } from '@headlessui/vue';
import { PencilSquareIcon } from '@heroicons/vue/24/outline';
import { ref, watch } from 'vue';

const props = defineProps({
  modelValue: Boolean,
  title: String,
  message: String,
  placeholder: String,
  confirmText: { type: String, default: 'Save' },
  cancelText: { type: String, default: 'Cancel' },
  initialValue: { type: String, default: '' }
});

const emit = defineEmits(['update:modelValue', 'confirm']);

const inputValue = ref(props.initialValue);
const inputRef = ref<HTMLInputElement | null>(null);

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    inputValue.value = props.initialValue;
    setTimeout(() => {
      inputRef.value?.focus();
    }, 100);
  }
});

const confirm = () => {
  if (inputValue.value) {
    emit('confirm', inputValue.value);
    emit('update:modelValue', false);
  }
};
</script>
