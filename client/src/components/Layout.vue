<script setup lang="ts">
// Layout.vue -- app shell.
//
// UI overhaul (2026-11): navigation moved from a crowded top bar (where the
// centered mobile logo overlapped the EN/ES switch and most pages hid behind
// a "Menu" dropdown) to AppSidebar.vue: a fixed sidebar on `lg+`, and the
// same component inside a slide-in drawer below that. The footer (copyright
// line, unrelated TCP-Streamer link) is gone; version + repo link live at
// the bottom of the sidebar.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSystemStore } from '../stores/system';
import { useRoute, useRouter } from 'vue-router';
import ToastNotification from './ToastNotification.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PromptDialog from './PromptDialog.vue';
import AppSidebar from './AppSidebar.vue';

const { t } = useI18n({ useScope: 'global' });
const systemStore = useSystemStore();
const route = useRoute();
const router = useRouter();

const isMobileMenuOpen = ref(false);

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') isMobileMenuOpen.value = false;
}

onMounted(async () => {
  // Theme is initialized synchronously in index.html before Vue mounts (see
  // the inline <script> there), so Login/Setup -- which don't render this
  // component -- also get the correct theme on first paint.
  document.addEventListener('keydown', onKeydown);
  await systemStore.fetchMode();
  // Auto-redirect to the correct view based on install mode
  if (systemStore.snapcastMode === 'client' && route.path === '/') {
    router.replace('/client');
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});

watch(() => route.fullPath, () => {
  isMobileMenuOpen.value = false;
});

const isClientMode = computed(
  () => route.path.startsWith('/client') || (route.path === '/logs' && route.query.filter === 'snapclient'),
);
</script>

<template>
  <div :class="['min-h-screen bg-brand-bg text-text-main font-sans relative', isClientMode ? 'theme-client' : 'theme-server']">
    <!-- Background accent (kept subtle: one wash, not two competing glows) -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      <div class="absolute -top-[25%] left-[10%] w-[60%] h-[50%] bg-brand-primary/[0.07] blur-[140px] rounded-full"></div>
    </div>

    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-line bg-brand-surface/70 backdrop-blur-xl">
      <AppSidebar />
    </aside>

    <!-- Mobile / tablet top bar -->
    <header class="lg:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 border-b border-line bg-brand-bg/85 backdrop-blur-xl">
      <button
        type="button"
        class="w-10 h-10 -ml-2 flex items-center justify-center rounded-lg text-text-muted hover:text-text-main hover:bg-inset"
        :aria-label="isMobileMenuOpen ? t('layout.closeMenu') : t('layout.openMenu')"
        :aria-expanded="isMobileMenuOpen"
        @click="isMobileMenuOpen = !isMobileMenuOpen"
      >
        <span class="material-symbols-outlined">menu</span>
      </button>
      <router-link to="/" class="flex items-center gap-2 min-w-0">
        <img src="../assets/logo.png" alt="" class="w-7 h-7 rounded-md object-cover" />
        <span class="text-sm font-bold text-text-main truncate">Snapcast <span class="text-brand-primary-text">Manager</span></span>
      </router-link>
    </header>

    <!-- Mobile drawer -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-150"
      leave-to-class="opacity-0"
    >
      <div v-if="isMobileMenuOpen" class="lg:hidden fixed inset-0 z-50">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="isMobileMenuOpen = false"></div>
        <aside class="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-brand-bg border-r border-line shadow-2xl">
          <AppSidebar show-close @navigate="isMobileMenuOpen = false" @close="isMobileMenuOpen = false" />
        </aside>
      </div>
    </Transition>

    <!-- Main content -->
    <main class="relative z-10 lg:pl-64">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10">
        <slot></slot>
      </div>
    </main>

    <!-- Global Components -->
    <ToastNotification />
    <ConfirmDialog />
    <PromptDialog />
  </div>
</template>
