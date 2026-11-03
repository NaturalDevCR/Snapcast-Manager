<script setup lang="ts">
// AppSidebar.vue -- UI overhaul (2026-11).
//
// The app's single navigation surface, rendered as a fixed sidebar on `lg+`
// and inside the mobile drawer below that (Layout.vue mounts it in both
// places). It replaces the old top bar, where only Dashboard and Audio
// Matrix were visible and every other page (Sources, Server Config,
// Diagnostics, ...) sat behind a "Menu" dropdown; there are few enough
// destinations that showing all of them, grouped, is the clearer option.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { serverNavGroups, isNavHrefActive } from '../utils/serverNav';
import { version } from '../../package.json';

defineProps<{ showClose?: boolean }>();
const emit = defineEmits<{ navigate: []; close: [] }>();

const { t } = useI18n({ useScope: 'global' });
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const systemStore = useSystemStore();
const uiStore = useUIStore();

const isClientMode = computed(
  () => route.path.startsWith('/client') || (route.path === '/logs' && route.query.filter === 'snapclient'),
);

interface NavLink {
  key: string;
  label: string;
  icon: string;
  to: string | { path: string; query?: Record<string, string> };
  active: boolean;
}

const primaryLinks = computed<NavLink[]>(() =>
  isClientMode.value
    ? [
        { key: 'client', label: t('layout.dashboard'), icon: 'speaker', to: '/client', active: route.path === '/client' },
        {
          key: 'client-logs',
          label: t('layout.logs'),
          icon: 'terminal',
          to: { path: '/logs', query: { filter: 'snapclient' } },
          active: route.path === '/logs',
        },
      ]
    : [
        { key: 'dashboard', label: t('layout.dashboard'), icon: 'space_dashboard', to: '/', active: route.path === '/' },
        { key: 'routing', label: t('layout.audioMatrix'), icon: 'hub', to: '/routing', active: isNavHrefActive(route.path, '/routing') },
      ],
);

const groups = computed(() =>
  isClientMode.value
    ? []
    : serverNavGroups.map((group) => ({
        key: group.key,
        label: t(group.labelKey),
        links: group.items.map<NavLink>((item) => ({
          key: item.href,
          label: t(item.nameKey),
          icon: item.icon,
          to: item.href,
          active: isNavHrefActive(route.path, item.href),
        })),
      })),
);

function switchMode(mode: 'server' | 'client') {
  router.push(mode === 'server' ? '/' : '/client');
  emit('navigate');
}

const linkClass = (active: boolean) => [
  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
  active
    ? 'bg-brand-primary/10 text-text-main font-semibold'
    : 'text-text-muted hover:bg-inset hover:text-text-main font-medium',
];
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Brand -->
    <div class="flex items-center justify-between gap-3 px-4 h-16 flex-shrink-0">
      <router-link to="/" class="flex items-center gap-2.5 min-w-0" @click="emit('navigate')">
        <img src="../assets/logo.png" alt="" class="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
        <span class="text-[15px] font-bold tracking-tight text-text-main truncate">
          Snapcast <span class="text-brand-primary-text">Manager</span>
        </span>
      </router-link>
      <button
        v-if="showClose"
        type="button"
        class="p-2 -mr-2 rounded-lg text-text-muted hover:text-text-main hover:bg-inset"
        :aria-label="t('layout.closeMenu')"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <!-- Mode switcher -->
    <div class="px-3 pb-3">
      <div
        v-if="systemStore.snapcastMode === 'both'"
        class="grid grid-cols-2 gap-1 rounded-lg bg-inset p-1 border border-line"
        role="group"
        :aria-label="`${t('layout.server')} / ${t('layout.client')}`"
      >
        <button
          v-for="mode in (['server', 'client'] as const)"
          :key="mode"
          type="button"
          :aria-pressed="mode === 'client' ? isClientMode : !isClientMode"
          :class="[
            (mode === 'client') === isClientMode
              ? 'bg-brand-surface text-text-main shadow-sm'
              : 'text-text-muted hover:text-text-main',
            'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
          ]"
          @click="switchMode(mode)"
        >
          <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">{{ mode === 'server' ? 'dns' : 'speaker' }}</span>
          {{ mode === 'server' ? t('layout.server') : t('layout.client') }}
        </button>
      </div>
      <div v-else class="flex items-center gap-2 rounded-lg bg-inset border border-line px-3 py-2 text-xs font-semibold text-text-muted">
        <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">{{ systemStore.snapcastMode === 'client' ? 'speaker' : 'dns' }}</span>
        {{ systemStore.snapcastMode === 'client' ? t('layout.clientMode') : t('layout.serverMode') }}
      </div>
    </div>

    <!-- Links -->
    <nav class="flex-1 overflow-y-auto px-3 pb-4 space-y-5" :aria-label="t('layout.primaryNav')">
      <div class="space-y-0.5">
        <router-link
          v-for="link in primaryLinks"
          :key="link.key"
          :to="link.to"
          :class="linkClass(link.active)"
          :aria-current="link.active ? 'page' : undefined"
          @click="emit('navigate')"
        >
          <span
            class="material-symbols-outlined text-[1.25rem]"
            :class="link.active ? 'text-brand-primary-text' : ''"
            aria-hidden="true"
          >{{ link.icon }}</span>
          {{ link.label }}
        </router-link>
      </div>

      <div v-for="group in groups" :key="group.key" class="space-y-0.5">
        <p class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted/80">{{ group.label }}</p>
        <router-link
          v-for="link in group.links"
          :key="link.key"
          :to="link.to"
          :class="linkClass(link.active)"
          :aria-current="link.active ? 'page' : undefined"
          @click="emit('navigate')"
        >
          <span
            class="material-symbols-outlined text-[1.25rem]"
            :class="link.active ? 'text-brand-primary-text' : ''"
            aria-hidden="true"
          >{{ link.icon }}</span>
          {{ link.label }}
        </router-link>
      </div>
    </nav>

    <!-- Footer: preferences + account -->
    <div class="border-t border-line p-3 space-y-3 flex-shrink-0">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center rounded-lg bg-inset border border-line p-0.5 text-xs font-semibold" role="group" :aria-label="t('layout.language')">
          <button
            v-for="loc in (['en', 'es'] as const)"
            :key="loc"
            type="button"
            :aria-pressed="uiStore.locale === loc"
            :class="uiStore.locale === loc ? 'bg-brand-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'"
            class="rounded-md px-2.5 py-1 transition-colors"
            @click="uiStore.setLocale(loc)"
          >{{ loc.toUpperCase() }}</button>
        </div>
        <button
          type="button"
          class="w-9 h-9 flex items-center justify-center rounded-lg bg-inset border border-line text-text-muted hover:text-text-main hover:bg-line transition-colors"
          :title="uiStore.isDark ? t('layout.switchToLight') : t('layout.switchToDark')"
          :aria-label="uiStore.isDark ? t('layout.switchToLight') : t('layout.switchToDark')"
          @click="uiStore.toggleTheme()"
        >
          <span class="material-symbols-outlined text-[1.15rem]" aria-hidden="true">{{ uiStore.isDark ? 'light_mode' : 'dark_mode' }}</span>
        </button>
      </div>

      <div class="flex items-center justify-between gap-2 rounded-lg px-1">
        <div class="min-w-0">
          <p class="text-[11px] text-text-muted leading-tight">{{ t('layout.signedInAs') }}</p>
          <p class="text-sm font-semibold text-text-main truncate">{{ authStore.user?.username || t('layout.admin') }}</p>
        </div>
        <button
          type="button"
          class="w-9 h-9 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
          :title="t('layout.signOut')"
          :aria-label="t('layout.signOut')"
          @click="authStore.logout(); emit('navigate')"
        >
          <span class="material-symbols-outlined text-[1.15rem]" aria-hidden="true">logout</span>
        </button>
      </div>

      <a
        href="https://github.com/NaturalDevCR/Snapcast-Manager"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center justify-between px-1 text-[11px] text-text-muted hover:text-text-main transition-colors"
      >
        <span>{{ t('layout.version', { version }) }}</span>
        <span class="inline-flex items-center gap-1">
          {{ t('layout.viewOnGithub') }}
          <span class="material-symbols-outlined text-[0.9rem]" aria-hidden="true">open_in_new</span>
        </span>
      </a>
    </div>
  </div>
</template>
