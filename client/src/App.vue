<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useUIStore } from './stores/ui';
import { useAuthStore } from './stores/auth';
import { useEventSource } from './composables/useEventSource';

const uiStore = useUIStore();
const authStore = useAuthStore();
const sse = useEventSource();

// Task 28: the shared, app-wide SSE connection (infrastructure only -- see
// task-28-brief.md; no view's polling is removed yet, that's Task 29).
// Gated on having a token: sse.connect() mints a ticket via
// `POST /auth/sse-ticket`, which 401s (and fetchApi would otherwise bounce
// straight to /login) with no token yet -- e.g. on first load of the
// login/setup pages, before authStore.token is populated. `immediate:
// true` also starts it right away on a page refresh while already logged
// in; logging out (authStore.token becomes '') tears the connection down.
watch(
  () => authStore.token,
  (token) => {
    if (token) sse.connect();
    else sse.disconnect();
  },
  { immediate: true }
);

// Warn the user shortly before their JWT expires so they don't lose unsaved
// work (e.g. in the config editor) to a silent 401 redirect.
let expiryTimer: ReturnType<typeof setInterval> | null = null;
let warned = false;

function tokenRemainingMs(): number | null {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part));
    if (!payload.exp) return null;
    return payload.exp * 1000 - Date.now();
  } catch {
    return null;
  }
}

onMounted(() => {
  expiryTimer = setInterval(() => {
    const remaining = tokenRemainingMs();
    if (remaining === null) {
      warned = false;
      return;
    }
    if (remaining <= 0) {
      warned = false;
      return; // next API call will redirect to /login
    }
    if (remaining < 10 * 60 * 1000 && !warned) {
      warned = true;
      const minutes = Math.max(1, Math.round(remaining / 60000));
      uiStore.showToast(`Your session expires in ~${minutes} min. Save your work and log in again soon.`, 'warning', 15000);
    }
  }, 60 * 1000);
});

onUnmounted(() => {
  if (expiryTimer) clearInterval(expiryTimer);
});
</script>

<template>
  <router-view></router-view>
</template>
