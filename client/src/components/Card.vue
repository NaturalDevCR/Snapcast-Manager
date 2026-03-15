<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<template>
  <div class="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg">
    <div class="px-4 py-5 sm:p-6">
      <h3 v-if="title || $slots.title" class="text-lg leading-6 font-medium text-gray-900 dark:text-white mb-4">
        <slot name="title">{{ title }}</slot>
      </h3>
      <slot></slot>
    </div>
  </div>
</template>
