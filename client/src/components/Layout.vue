<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';
import { useRoute } from 'vue-router';
import ToastNotification from './ToastNotification.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PromptDialog from './PromptDialog.vue';

const authStore = useAuthStore();
const uiStore = useUIStore();
const route = useRoute();

onMounted(() => {
  uiStore.initTheme();
});

const isMobileMenuOpen = ref(false);

const navigation = [
  { name: 'Dashboard', href: '/', icon: 'dashboard' },
  { name: 'Configuration', href: '/server', icon: 'settings' },
  { name: 'Logs', href: '/logs', icon: 'terminal' },
  { name: 'Watchdogs', href: '/watchdogs', icon: 'monitor_heart' },
];
</script>

<template>
  <div class="min-h-screen bg-brand-bg text-white font-sans flex flex-col transition-colors duration-500 relative">
    <!-- Background Accents (From Stitch Login/Dashboard) -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div class="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-brand-primary/10 blur-[120px] rounded-full"></div>
        <div class="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
    </div>

    <!-- Navigation Bar -->
    <nav class="sticky top-0 z-40 bg-brand-bg/80 backdrop-blur-xl border-b border-white/5 shadow-2xl">
      <div class="px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-20 items-center relative">
          <!-- Burger Button (Mobile Left) -->
          <button 
            @click="isMobileMenuOpen = !isMobileMenuOpen"
            class="p-2 mr-3 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-xl border border-white/5 transition-all duration-300 sm:hidden flex items-center justify-center self-center"
            title="Open Menu"
          >
            <span class="material-symbols-outlined text-[1.3rem]">menu</span>
          </button>

          <!-- Brand centered on mobile, absolute left-1/2 -->
          <div class="absolute left-1/2 -translate-x-1/2 flex items-center gap-3 sm:static sm:translate-x-0 sm:left-auto sm:flex-shrink-0">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shadow-brand-primary/20">
                <img src="../assets/logo.png" alt="Logo" class="w-full h-full rounded-xl object-cover" />
            </div>
            <span class="text-xl font-black tracking-tight text-white hidden sm:block drop-shadow-sm">Snapcast <span class="text-brand-primary">Manager</span></span>
          </div>
          
          <!-- Desktop Nav (Desktop Only) -->
          <div class="hidden sm:ml-10 sm:flex sm:space-x-2 sm:items-center sm:mr-auto">
            <router-link
              v-for="item in navigation"
              :key="item.name"
              :to="item.href"
              :class="[
                route.path === item.href
                  ? 'bg-white/10 text-white shadow-inner border border-white/5'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white',
                'px-4 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 flex items-center gap-2'
              ]"
            >
              <span class="material-symbols-outlined text-[1.1rem]" :class="route.path === item.href ? 'text-brand-primary' : ''">{{ item.icon }}</span>
              {{ item.name }}
            </router-link>
          </div>
          
          <div class="flex items-center space-x-2">
            <!-- User Profile / Logout -->
            <div class="flex items-center gap-3 pl-3 border-l border-white/10">
                <div class="text-right hidden sm:block">
                    <p class="text-sm font-bold text-white leading-tight">Admin</p>
                    <p class="text-xs text-brand-primary font-medium">Session Active</p>
                </div>
                <button 
                  @click="authStore.logout()"
                  class="p-2.5 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl border border-white/5 transition-all duration-300 group flex items-center justify-center"
                  title="Sign out"
                >
                    <span class="material-symbols-outlined text-[1.2rem] group-hover:scale-110 transition-transform">logout</span>
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
            <div class="flex items-center justify-between pb-6 border-b border-white/5">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shadow-brand-primary/20">
                    <img src="../assets/logo.png" alt="Logo" class="w-full h-full rounded-xl object-cover" />
                </div>
                <span class="text-xl font-black text-white">Snapcast <span class="text-brand-primary">Manager</span></span>
              </div>
              <button @click="isMobileMenuOpen = false" class="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>

            <!-- Navigation Links -->
            <div class="flex flex-col gap-2 mt-6">
              <router-link
                v-for="item in navigation"
                :key="item.name"
                :to="item.href"
                @click="isMobileMenuOpen = false"
                :class="[
                  route.path === item.href
                    ? 'bg-white/10 text-white shadow-inner border border-white/5'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white',
                  'px-4 py-3 rounded-xl font-bold text-sm transition-all duration-300 flex items-center gap-3'
                ]"
              >
                <span class="material-symbols-outlined text-[1.2rem]" :class="route.path === item.href ? 'text-brand-primary' : ''">{{ item.icon }}</span>
                {{ item.name }}
              </router-link>
            </div>

            <!-- User Info (Bottom) -->
            <div class="mt-auto pt-6 border-t border-white/5 flex items-center justify-between">
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
        <div>
          &copy; 2026 Snapcast Manager. All rights reserved.
        </div>
        <div class="flex items-center gap-4">
          <a href="https://github.com/NaturalDevCR/TCP-Streamer" target="_blank" class="flex items-center gap-1.5 hover:text-white text-gray-400 font-medium transition-colors duration-300">
            <span class="material-symbols-outlined text-[1rem]">link</span>
            TCP-Streamer Project
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
