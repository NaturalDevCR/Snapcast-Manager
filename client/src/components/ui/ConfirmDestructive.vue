<script setup lang="ts">
// ConfirmDestructive.vue — Task 22 UI primitive.
//
// Built ON TOP of Modal.vue (composition, not duplication of the dialog
// machinery) — implements the "type the entity name to confirm" safety
// pattern the design spec requires for destructive actions
// (docs/superpowers/specs/2026-08-18-professional-hardening-design.md §4.7).
//
// SAFETY-CRITICAL DESIGN NOTES (read before touching this file):
//
// 1. Exact match only. `isMatch` below is `typedName.value === entityName`
//    — no `.trim()`, no `.toLowerCase()`, no partial/startsWith check. A
//    case-insensitive or trimmed match would let someone confirm by typing
//    something merely close to the entity name (e.g. pasting a similar
//    name, or a name with trailing whitespace from a copy-paste), which
//    defeats the entire point of this pattern: proving the user actually
//    read and typed *this* entity's exact name, not just clicked through.
//
// 2. There are exactly two ways this component can close, and only one of
//    them can ever emit `confirm`:
//      - `onModalUpdate` handles every path that closes the dialog WITHOUT
//        confirming: Modal's own Escape/backdrop/close-(X)-button
//        dismissal (all of which surface as Modal's `update:modelValue`
//        v-model event, wired to this function), and this component's own
//        Cancel button (which also calls this function). Every one of
//        these emits `cancel` and relays `update:modelValue(false)` — none
//        of them ever touches `confirm`.
//      - `onConfirm` is the ONLY code path that emits `confirm`, and it is
//        wired to nothing but the confirm button's own `@click`. It
//        re-checks `isMatch` itself before emitting anything (defense in
//        depth on top of the button's native `disabled` attribute, which
//        already blocks the click from firing at all) — so even if a
//        future change to Button.vue's disabled handling ever regressed,
//        this handler alone still can't be tricked into confirming on a
//        mismatched name.
//    In other words: Modal closing itself can NEVER emit `confirm` — that
//    emission is reachable from exactly one line in this file.
//
// 3. Typed text resets on every open/close transition (see the `watch`
//    below), so a match typed for one entity can never silently carry over
//    and pre-satisfy the check the next time this dialog opens for a
//    different entity.
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import Button from './Button.vue';
import Input from './Input.vue';

export interface ConfirmDestructiveProps {
  modelValue: boolean;
  title?: string;
  message?: string;
  entityName: string;
  confirmLabel?: string;
}

const props = withDefaults(defineProps<ConfirmDestructiveProps>(), {
  title: undefined,
  message: undefined,
  confirmLabel: 'Delete',
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
  cancel: [];
}>();

const typedName = ref('');

watch(
  () => props.modelValue,
  (isOpen) => {
    if (!isOpen) {
      typedName.value = '';
    }
  },
);

const isMatch = computed(() => typedName.value === props.entityName);

function onModalUpdate(value: boolean) {
  emit('update:modelValue', value);
  if (!value) {
    emit('cancel');
  }
}

function onConfirm() {
  if (!isMatch.value) {
    return;
  }
  emit('confirm');
  emit('update:modelValue', false);
}
</script>

<template>
  <Modal :model-value="modelValue" :title="title" size="sm" @update:model-value="onModalUpdate">
    <div class="space-y-4">
      <p v-if="message" class="text-sm text-text-muted">{{ message }}</p>
      <p class="text-sm text-text-muted">
        Type <span class="font-black text-text-main">{{ entityName }}</span> to confirm.
      </p>
      <Input v-model="typedName" label="Confirmation" :placeholder="entityName" />
    </div>
    <template #footer>
      <Button variant="secondary" @click="onModalUpdate(false)">Cancel</Button>
      <Button variant="danger" :disabled="!isMatch" @click="onConfirm">{{ confirmLabel }}</Button>
    </template>
  </Modal>
</template>
