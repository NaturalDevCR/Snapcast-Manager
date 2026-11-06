<script setup lang="ts">
// One source in the Audio Matrix: a card with the handle a cable is dragged
// from. `compact` is the short card used for sources no zone plays, whose
// handle sits inside the card since no cable leaves it.
import type { VNodeRef } from 'vue';

defineProps<{
  label: string;
  detail: string;
  color: string;
  playing: boolean;
  dragging: boolean;
  dragHint: string;
  handleRef: VNodeRef;
  compact?: boolean;
}>();

defineEmits<{ 'start-drag': [event: MouseEvent | TouchEvent] }>();
</script>

<template>
  <div
    class="relative flex items-center gap-3 min-w-0 rounded-xl border border-line border-l-[3px] bg-inset"
    :class="compact ? 'p-2 pl-3' : 'p-3 xl:pr-6 xl:self-start'"
    :style="{ borderLeftColor: color }"
  >
    <span
      class="material-symbols-outlined text-lg shrink-0 opacity-80"
      :style="{ color }"
      aria-hidden="true"
      >cast</span
    >
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold text-text-main text-sm truncate" :title="label">{{
          label
        }}</span>
        <span
          class="w-2 h-2 rounded-full shrink-0"
          :class="playing ? 'animate-pulse' : 'opacity-40'"
          :style="{ backgroundColor: color }"
          aria-hidden="true"
        ></span>
      </div>
      <div class="text-xs text-text-muted mt-0.5 truncate">{{ detail }}</div>
    </div>

    <!-- Mouse/touch only: each zone's <Select> is the accessible way to route
         audio, so the handle stays out of the a11y tree. touch-none keeps the
         browser from scrolling the page instead of starting the drag, and the
         pseudo-element widens the target past the visible circle. Stacked,
         left-[23px] lines its center up with the zone nodes below (pl-10 in
         Routing.vue, less this card's 3px border and half the handle). -->
    <div
      :ref="handleRef"
      class="w-7 h-7 rounded-full bg-brand-surface border-[3px] flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-110 transition-transform shrink-0 touch-none z-10 after:absolute after:-inset-2 after:content-['']"
      :class="
        compact
          ? 'relative'
          : 'absolute left-[23px] -bottom-3.5 xl:left-auto xl:bottom-auto xl:-right-3.5 xl:top-1/2 xl:-translate-y-1/2'
      "
      :style="{ borderColor: color }"
      :title="dragHint"
      aria-hidden="true"
      @mousedown.prevent="$emit('start-drag', $event)"
      @touchstart.prevent="$emit('start-drag', $event)"
    >
      <div
        class="w-2.5 h-2.5 rounded-full"
        :class="{ 'animate-ping opacity-50': dragging }"
        :style="{ backgroundColor: color }"
      ></div>
      <div class="w-2.5 h-2.5 rounded-full absolute" :style="{ backgroundColor: color }"></div>
    </div>
  </div>
</template>
