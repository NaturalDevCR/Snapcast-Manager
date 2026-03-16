<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import { useRoute } from 'vue-router';
import ToastNotification from './ToastNotification.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import PromptDialog from './PromptDialog.vue';

const authStore = useAuthStore();
const route = useRoute();

const navigation = [
  { name: 'Dashboard', href: '/', icon: 'dashboard' },
  { name: 'Configuration', href: '/server', icon: 'settings' },
  { name: 'Logs', href: '/logs', icon: 'terminal' },
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
        <div class="flex justify-between h-20">
          <div class="flex">
            <!-- Brand -->
            <div class="flex-shrink-0 flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-primary to-indigo-600 flex items-center justify-center shadow-lg shadow-brand-primary/20">
                  <span class="material-symbols-outlined text-white text-xl">graphic_eq</span>
              </div>
              <span class="text-xl font-black tracking-tight text-white hidden sm:block drop-shadow-sm">Snapcast <span class="text-brand-primary">Manager</span></span>
            </div>
            
            <!-- Desktop Nav -->
            <div class="hidden sm:ml-10 sm:flex sm:space-x-2 sm:items-center">
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
          </div>
          
          <div class="flex items-center space-x-4">
            <!-- User Profile / Logout -->
            <div class="flex items-center gap-3 pl-4 border-l border-white/10">
                <div class="text-right hidden sm:block">
                    <p class="text-sm font-bold text-white leading-tight">Admin</p>
                    <p class="text-xs text-brand-primary font-medium">Session Active</p>
                </div>
                <button 
                  @click="authStore.logout()"
                  class="p-2.5 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-xl border border-white/5 transition-all duration-300 group"
                  title="Sign out"
                >
                    <span class="material-symbols-outlined text-[1.2rem] group-hover:scale-110 transition-transform">logout</span>
                </button>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-grow z-10 relative">
      <div class="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <slot></slot>
      </div>
    </main>

    <!-- Global Components -->
    <ToastNotification />
    <ConfirmDialog />
    <PromptDialog />
  </div>
</template>
