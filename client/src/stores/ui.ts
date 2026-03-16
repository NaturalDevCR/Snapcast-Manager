import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration?: number;
}

export const useUIStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;
  const isDark = ref(localStorage.getItem('theme') !== 'light'); // Default to true (dark)

  function toggleTheme() {
    isDark.value = !isDark.value;
    if (isDark.value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
  }

  function initTheme() {
    if (isDark.value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  function showToast(message: string, type: ToastType = 'info', duration: number = 5000) {
    const id = nextId++;
    toasts.value.push({ id, message, type, duration });
    
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }

  function removeToast(id: number) {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  return {
    toasts,
    isDark,
    toggleTheme,
    initTheme,
    showToast,
    removeToast
  };
});
