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

// Post-v0.3.4 fix, found live (theme reverting to light on every reload):
// every OTHER localStorage read/write in this file already guards against
// it throwing (index.html's own pre-mount init script wraps its read in
// try/catch, falling back to dark) -- this one, the store's own initial
// read, never did. `localStorage.getItem`/`setItem` throw a real
// SecurityError in some genuinely common cases: Safari's/Chrome's "Block
// all cookies"-class privacy settings, a strict per-site storage-access
// policy on a plain-HTTP origin, or a private-browsing mode that disables
// persistent storage entirely -- this app's own documented default
// deployment (bare HTTP, no reverse proxy, e.g. a LAN Raspberry Pi) is
// exactly the kind of origin such policies target. An uncaught throw here
// happens at MODULE INIT time (this line runs the moment the store is
// first used), so it would have silently broken the entire store, not
// just the theme -- toggleTheme()'s own write throwing separately would
// change `isDark` in memory (so the toggle LOOKS like it worked) while the
// write itself silently failed, exactly the "toggle works until I reload"
// symptom reported. Both reads/writes now degrade to "use the in-memory
// value only, this session" instead of throwing.
function readStoredTheme(): string | null {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}

function writeStoredTheme(value: 'dark' | 'light'): void {
  try {
    localStorage.setItem('theme', value);
  } catch {
    // Storage unavailable (private mode, strict cookie/storage policy on a
    // plain-HTTP origin, etc.) -- the toggle still works for this session
    // via the in-memory `isDark` ref; it just won't survive a reload.
  }
}

export const useUIStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([]);
  let nextId = 1;
  const isDark = ref(readStoredTheme() !== 'light'); // Default to true (dark)
  const locale = ref<SupportedLocale>(i18n.global.locale.value as SupportedLocale);

  function toggleTheme() {
    isDark.value = !isDark.value;
    if (isDark.value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    writeStoredTheme(isDark.value ? 'dark' : 'light');
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
