import { defineStore } from 'pinia';
import { ref } from 'vue';
import { i18n, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n';

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
  const locale = ref<SupportedLocale>(i18n.global.locale.value as SupportedLocale);

  function toggleTheme() {
    isDark.value = !isDark.value;
    if (isDark.value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
  }

  function setLocale(l: SupportedLocale) {
    if (!SUPPORTED_LOCALES.includes(l)) return;
    locale.value = l;
    i18n.global.locale.value = l;
    localStorage.setItem('locale', l);
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
    locale,
    toggleTheme,
    setLocale,
    initTheme,
    showToast,
    removeToast
  };
});
