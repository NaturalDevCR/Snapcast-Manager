<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';
import { useRoute, useRouter } from 'vue-router';
import ToastNotification from './ToastNotification.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PromptDialog from './PromptDialog.vue';
import { version } from '../../package.json';

const authStore = useAuthStore();
const uiStore = useUIStore();
const route = useRoute();
const router = useRouter();

onMounted(() => {
  uiStore.initTheme();
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

const isMobileMenuOpen = ref(false);
const isSystemMenuOpen = ref(false);
const isMobileSystemOpen = ref(false);
const systemMenuRef = ref<HTMLElement | null>(null);

const isClientMode = computed(() => route.path.startsWith('/client'));

// Primary nav links (always visible)
const serverPrimaryNav = [
  { name: 'Dashboard', href: '/', icon: 'dashboard' },
  { name: 'Audio Matrix', href: '/routing', icon: 'grid_view' },
];

// System submenu items
const serverSystemNav: Array<{
  name: string; href: string; icon: string; description: string;
  to?: string | object;
  activeWhen?: (r: typeof route) => boolean;
}> = [
  { name: 'Logs', href: '/logs', icon: 'terminal', description: 'Service logs' },
  { name: 'Configuration', href: '/server', icon: 'settings', description: 'Snapserver settings',
    activeWhen: (r) => r.path.startsWith('/server') && r.query.tab !== 'security' },
  { name: 'Security', href: '/server', icon: 'security', description: 'Admin access',
    to: { path: '/server', query: { tab: 'security' } },
    activeWhen: (r) => r.path.startsWith('/server') && r.query.tab === 'security' },
  { name: 'Watchdogs', href: '/watchdogs', icon: 'monitor_heart', description: 'Service monitors' },
];

const clientNavigation = [
  { name: 'Dashboard', href: '/client', icon: 'speaker' },
  { name: 'Logs', href: '/logs', icon: 'terminal', to: { path: '/logs', query: { filter: 'snapclient' } } },
];

const navigation = computed(() => isClientMode.value ? clientNavigation : serverPrimaryNav);

const isItemActive = (item: typeof serverSystemNav[number]) => {
  if (item.activeWhen) return item.activeWhen(route);
  return isNavActive(item.href);
};

const isSystemActive = computed(() =>
  serverSystemNav.some(item => isItemActive(item))
);

const isNavActive = (href: string) => {
  if (href === '/') return route.path === '/';
  return route.path.startsWith(href);
};

function switchMode(mode: 'server' | 'client') {
  if (mode === 'server') router.push('/');
  else router.push('/client');
  isMobileMenuOpen.value = false;
}

function handleClickOutside(e: MouseEvent) {
  if (systemMenuRef.value && !systemMenuRef.value.contains(e.target as Node)) {
    isSystemMenuOpen.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-brand-bg text-white font-sans flex flex-col transition-colors duration-500 relative">
    <!-- Background Accents -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-brand-primary/10 blur-[120px] rounded-full"></div>
        <div class="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
    </div>

    <!-- Navigation Bar -->
    <nav class="sticky top-0 z-40 bg-brand-bg/80 backdrop-blur-xl border-b border-white/5 shadow-2xl">
      <div class="px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-14 items-center relative">

          <!-- Burger Button (Mobile) -->
          <button
            @click="isMobileMenuOpen = !isMobileMenuOpen"
            class="p-2 mr-3 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl border border-white/5 transition-all duration-300 sm:hidden flex items-center justify-center"
            title="Open Menu"
          >
            <span class="material-symbols-outlined text-[1.2rem]">menu</span>
          </button>

          <!-- Brand -->
          <div class="absolute left-1/2 -translate-x-1/2 flex items-center gap-2.5 sm:static sm:translate-x-0 sm:left-auto sm:flex-shrink-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center shadow-lg shadow-brand-primary/20">
                <img src="../assets/logo.png" alt="Logo" class="w-full h-full rounded-lg object-cover" />
            </div>
            <span class="text-base font-black tracking-tight text-white hidden sm:block drop-shadow-sm">Snapcast <span class="text-brand-primary">Manager</span></span>
          </div>

          <!-- Desktop Nav -->
          <div class="hidden sm:ml-5 sm:flex sm:items-center sm:mr-auto sm:gap-0.5">

            <!-- Mode Switcher -->
            <div class="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/5 mr-3">
              <button
                @click="switchMode('server')"
                :class="[!isClientMode ? 'bg-brand-primary text-white shadow-md' : 'text-gray-400 hover:text-white', 'px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1']"
              >
                <span class="material-symbols-outlined text-[0.85rem]">dns</span>
                Server
              </button>
              <button
                @click="switchMode('client')"
                :class="[isClientMode ? 'bg-brand-primary text-white shadow-md' : 'text-gray-400 hover:text-white', 'px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider transition-all duration-200 flex items-center gap-1']"
              >
                <span class="material-symbols-outlined text-[0.85rem]">speaker</span>
                Client
              </button>
            </div>

            <!-- Divider -->
            <div class="h-5 w-px bg-white/10 mr-3"></div>

            <!-- Primary Nav Links -->
            <router-link
              v-for="item in navigation"
              :key="item.name"
              :to="item.href"
              :class="[
                isNavActive(item.href)
                  ? 'bg-white/10 text-white border border-white/5'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white border border-transparent',
                'px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-200 flex items-center gap-1.5 uppercase tracking-wide'
              ]"
            >
              <span class="material-symbols-outlined text-[1rem]" :class="isNavActive(item.href) ? 'text-brand-primary' : ''">{{ item.icon }}</span>
              {{ item.name }}
            </router-link>

            <!-- System Dropdown (Server mode only) -->
            <div v-if="!isClientMode" ref="systemMenuRef" class="relative ml-0.5">
              <button
                @click.stop="isSystemMenuOpen = !isSystemMenuOpen"
                :class="[
                  isSystemActive
                    ? 'bg-white/10 text-white border-white/5'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white border-transparent',
                  'px-3 py-1.5 rounded-lg font-bold text-xs transition-all duration-200 flex items-center gap-1.5 uppercase tracking-wide border'
                ]"
              >
                <span class="material-symbols-outlined text-[1rem]" :class="isSystemActive ? 'text-brand-primary' : ''">build</span>
                System
                <span
                  class="material-symbols-outlined text-[0.85rem] transition-transform duration-200 opacity-60"
                  :class="isSystemMenuOpen ? 'rotate-180' : ''"
                >expand_more</span>
              </button>

              <!-- Dropdown Panel -->
              <Transition
                enter-active-class="transition duration-150 ease-out"
                enter-from-class="opacity-0 scale-95 -translate-y-1"
                enter-to-class="opacity-100 scale-100 translate-y-0"
                leave-active-class="transition duration-100 ease-in"
                leave-from-class="opacity-100 scale-100 translate-y-0"
                leave-to-class="opacity-0 scale-95 -translate-y-1"
              >
                <div
                  v-if="isSystemMenuOpen"
                  class="absolute top-full left-0 mt-2 w-52 bg-[#1a0e24]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50 py-1.5"
                >
                  <router-link
                    v-for="item in serverSystemNav"
                    :key="item.name"
                    :to="item.to ?? item.href"
                    @click="isSystemMenuOpen = false"
                    :class="[
                      isItemActive(item)
                        ? 'bg-brand-primary/15 text-white'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white',
                      'flex items-center gap-3 px-4 py-2.5 transition-all duration-150 mx-1.5 rounded-xl'
                    ]"
                  >
                    <span
                      class="material-symbols-outlined text-[1.1rem] flex-shrink-0"
                      :class="isItemActive(item) ? 'text-brand-primary' : 'text-gray-500'"
                    >{{ item.icon }}</span>
                    <div>
                      <p class="text-xs font-black uppercase tracking-wide leading-tight">{{ item.name }}</p>
                      <p class="text-[10px] text-gray-500 font-medium mt-0.5">{{ item.description }}</p>
                    </div>
                    <span v-if="isItemActive(item)" class="ml-auto w-1.5 h-1.5 rounded-full bg-brand-primary shadow-[0_0_6px_rgba(166,13,242,0.8)]"></span>
                  </router-link>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Right: User + Logout -->
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-2.5 sm:pl-3 sm:border-l sm:border-white/10">
                <div class="text-right hidden sm:block">
                    <p class="text-xs font-bold text-white leading-tight">Admin</p>
                    <p class="text-[10px] text-brand-primary font-medium">Session Active</p>
                </div>
                <button
                  @click="authStore.logout()"
                  class="p-2 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl border border-white/5 transition-all duration-300 group flex items-center justify-center"
                  title="Sign out"
                >
                    <span class="material-symbols-outlined text-[1.1rem] group-hover:scale-110 transition-transform">logout</span>
                </button>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <!-- Mobile Navigation Drawer -->
    <Transition
      enter-active-class="transition-opacity ease-linear duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity ease-linear duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="isMobileMenuOpen" class="fixed inset-0 z-50 sm:hidden">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="isMobileMenuOpen = false"></div>

        <!-- Sliding Panel -->
        <Transition
          enter-active-class="transition ease-out duration-300 transform"
          enter-from-class="-translate-x-full"
          enter-to-class="translate-x-0"
          leave-active-class="transition ease-in duration-200 transform"
          leave-from-class="translate-x-0"
          leave-to-class="-translate-x-full"
        >
          <div v-if="isMobileMenuOpen" class="absolute inset-y-0 left-0 w-72 bg-brand-bg/95 border-r border-white/5 backdrop-blur-xl p-6 flex flex-col shadow-3xl">
            <!-- Header -->
            <div class="flex items-center justify-between pb-5 border-b border-white/5">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-brand-primary/20">
                    <img src="../assets/logo.png" alt="Logo" class="w-full h-full rounded-xl object-cover" />
                </div>
                <span class="text-lg font-black text-white">Snapcast <span class="text-brand-primary">Manager</span></span>
              </div>
              <button @click="isMobileMenuOpen = false" class="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <!-- Mode Switcher (Mobile) -->
            <div class="flex items-center bg-white/5 rounded-xl p-1 border border-white/5 mt-5">
              <button
                @click="switchMode('server')"
                :class="[!isClientMode ? 'bg-brand-primary text-white shadow-md' : 'text-gray-400 hover:text-white', 'flex-1 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-1.5']"
              >
                <span class="material-symbols-outlined text-[0.9rem]">dns</span>
                Server
              </button>
              <button
                @click="switchMode('client')"
                :class="[isClientMode ? 'bg-brand-primary text-white shadow-md' : 'text-gray-400 hover:text-white', 'flex-1 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-1.5']"
              >
                <span class="material-symbols-outlined text-[0.9rem]">speaker</span>
                Client
              </button>
            </div>

            <!-- Navigation Links -->
            <div class="flex flex-col gap-1 mt-4">
              <!-- Primary links -->
              <router-link
                v-for="item in navigation"
                :key="item.name"
                :to="(item as any).to ?? item.href"
                @click="isMobileMenuOpen = false"
                :class="[
                  isNavActive(item.href)
                    ? 'bg-white/10 text-white border border-white/5'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white border border-transparent',
                  'px-4 py-3 rounded-xl font-bold text-sm transition-all duration-200 flex items-center gap-3'
                ]"
              >
                <span class="material-symbols-outlined text-[1.2rem]" :class="isNavActive(item.href) ? 'text-brand-primary' : ''">{{ item.icon }}</span>
                {{ item.name }}
              </router-link>

              <!-- System Section (Server mode only) -->
              <template v-if="!isClientMode">
                <!-- System collapsible header -->
                <button
                  @click="isMobileSystemOpen = !isMobileSystemOpen"
                  :class="[
                    isSystemActive
                      ? 'bg-white/10 text-white border-white/5'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white border-transparent',
                    'px-4 py-3 rounded-xl font-bold text-sm transition-all duration-200 flex items-center gap-3 border w-full text-left mt-1'
                  ]"
                >
                  <span class="material-symbols-outlined text-[1.2rem]" :class="isSystemActive ? 'text-brand-primary' : ''">build</span>
                  <span class="flex-1">System</span>
                  <span
                    class="material-symbols-outlined text-[1rem] opacity-50 transition-transform duration-200"
                    :class="isMobileSystemOpen || isSystemActive ? 'rotate-180' : ''"
                  >expand_more</span>
                </button>

                <!-- System submenu items -->
                <Transition
                  enter-active-class="transition-all duration-200 ease-out overflow-hidden"
                  enter-from-class="opacity-0 max-h-0"
                  enter-to-class="opacity-100 max-h-40"
                  leave-active-class="transition-all duration-150 ease-in overflow-hidden"
                  leave-from-class="opacity-100 max-h-40"
                  leave-to-class="opacity-0 max-h-0"
                >
                  <div v-if="isMobileSystemOpen || isSystemActive" class="ml-4 flex flex-col gap-1 border-l border-white/10 pl-3">
                    <router-link
                      v-for="item in serverSystemNav"
                      :key="item.name"
                      :to="item.to ?? item.href"
                      @click="isMobileMenuOpen = false"
                      :class="[
                        isItemActive(item)
                          ? 'text-white'
                          : 'text-gray-500 hover:text-gray-300',
                        'py-2 text-sm font-bold transition-all duration-200 flex items-center gap-2.5'
                      ]"
                    >
                      <span class="material-symbols-outlined text-[1rem]" :class="isItemActive(item) ? 'text-brand-primary' : ''">{{ item.icon }}</span>
                      {{ item.name }}
                    </router-link>
                  </div>
                </Transition>
              </template>
            </div>

            <!-- User Info (Bottom) -->
            <div class="mt-auto pt-5 border-t border-white/5 flex items-center justify-between">
              <div>
                <p class="text-sm font-bold text-white">Admin</p>
                <p class="text-xs text-brand-primary font-medium">Session Active</p>
              </div>
              <button
                @click="authStore.logout(); isMobileMenuOpen = false"
                class="p-2.5 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl border border-white/5 transition-all duration-300"
              >
                <span class="material-symbols-outlined text-[1.2rem]">logout</span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Main Content -->
    <main class="flex-grow z-10 relative">
      <div class="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <slot></slot>
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-brand-bg/80 backdrop-blur-xl border-t border-white/5 py-6 mt-12 z-10 relative">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-gray-500">
        <div class="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
          <span class="font-black tracking-widest uppercase text-[10px]">&copy; 2026 Snapcast Manager Ecosystem</span>
          <span class="hidden sm:inline-block text-white/20">&bull;</span>
          <span class="font-black tracking-widest uppercase text-[10px]">VERSION {{ version }}</span>
        </div>
        <div class="flex flex-col sm:flex-row items-center gap-4">
          <a href="https://github.com/NaturalDevCR/TCP-Streamer" target="_blank" class="flex items-center gap-1 hover:text-white text-gray-400 font-bold transition-colors duration-300">
            <span class="material-symbols-outlined text-[1rem]">link</span>
            TCP-Streamer
          </a>
          <span class="hidden sm:inline-block text-white/20">&bull;</span>
          <a href="https://github.com/jdavidoa91/Snapcast-Manager" target="_blank" rel="noopener noreferrer" class="flex items-center gap-1 text-brand-primary hover:text-[#8e0bc9] font-black transition-colors group">
             <span>Developed by NaturalDevCR</span>
             <span class="material-symbols-outlined text-[14px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </a>
        </div>
      </div>
    </footer>

    <!-- Global Components -->
    <ToastNotification />
    <ConfirmDialog />
    <PromptDialog />
  </div>
</template>
