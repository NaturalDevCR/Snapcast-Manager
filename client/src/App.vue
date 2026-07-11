<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useUIStore } from './stores/ui';

const uiStore = useUIStore();

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
