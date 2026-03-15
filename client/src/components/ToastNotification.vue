<script setup lang="ts">
import { useUIStore } from '../stores/ui';
import { 
    CheckCircleIcon, 
    ExclamationCircleIcon, 
    InformationCircleIcon, 
    ExclamationTriangleIcon,
    XMarkIcon
} from '@heroicons/vue/24/outline';

const uiStore = useUIStore();

const typeConfigs = {
  success: {
    bg: 'bg-emerald-500/90 dark:bg-emerald-500/20',
    border: 'border-emerald-500/50',
    text: 'text-white dark:text-emerald-400',
    icon: CheckCircleIcon,
    glow: 'shadow-emerald-500/40'
  },
  error: {
    bg: 'bg-red-500/90 dark:bg-red-500/20',
    border: 'border-red-500/50',
    text: 'text-white dark:text-red-400',
    icon: ExclamationCircleIcon,
    glow: 'shadow-red-500/40'
  },
  info: {
    bg: 'bg-indigo-600/90 dark:bg-indigo-500/20',
    border: 'border-indigo-500/50',
    text: 'text-white dark:text-indigo-400',
    icon: InformationCircleIcon,
    glow: 'shadow-indigo-500/40'
  },
  warning: {
    bg: 'bg-amber-500/90 dark:bg-amber-500/20',
    border: 'border-amber-500/50',
    text: 'text-white dark:text-amber-400',
    icon: ExclamationTriangleIcon,
    glow: 'shadow-amber-500/40'
  }
};
</script>

<template>
  <div class="fixed top-6 right-6 z-[9999] flex flex-col space-y-3 max-w-sm w-full pointer-events-none">
    <TransitionGroup 
      name="toast"
      enter-active-class="transform ease-out duration-500 transition"
      enter-from-class="translate-y-4 opacity-0 sm:translate-y-0 sm:translate-x-10 scale-95"
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0 scale-100"
      leave-active-class="transition ease-in duration-300 pointer-events-none absolute"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-90"
    >
      <div 
        v-for="toast in uiStore.toasts" 
        :key="toast.id"
        class="pointer-events-auto relative group overflow-hidden backdrop-blur-xl rounded-2xl border p-4 shadow-2xl flex items-center transition-all duration-300"
        :class="[typeConfigs[toast.type].bg, typeConfigs[toast.type].border, typeConfigs[toast.type].glow]"
      >
        <!-- Progress Bar -->
        <div class="absolute bottom-0 left-0 h-1 bg-white/20 w-full overflow-hidden">
            <div class="h-full bg-white/40 animate-shrink"></div>
        </div>

        <div class="flex-shrink-0 mr-3">
            <component :is="typeConfigs[toast.type].icon" class="h-6 w-6" :class="typeConfigs[toast.type].text" />
        </div>
        
        <div class="flex-1 text-xs font-black uppercase tracking-widest" :class="typeConfigs[toast.type].text">
          {{ toast.message }}
        </div>

        <button 
          @click="uiStore.removeToast(toast.id)"
          class="ml-4 flex-shrink-0 p-1 rounded-lg hover:bg-white/10 transition-colors"
          :class="typeConfigs[toast.type].text"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-move {
  transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes shrink {
    from { width: 100%; }
    to { width: 0%; }
}

.animate-shrink {
    animation: shrink 5 linear forwards;
    animation-duration: inherit; /* Matches duration from store if we could pass it, but defaulting to 5s */
}
</style>
