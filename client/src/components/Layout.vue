<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import ToastNotification from './ToastNotification.vue';

const authStore = useAuthStore();

const logout = () => {
  authStore.logout();
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans selection:bg-indigo-500/30">
    <ToastNotification />
    
    <!-- Navbar -->
    <nav class="sticky top-0 z-40 w-full backdrop-blur-md bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 transition-all duration-300">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <div class="flex items-center space-x-8">
            <div class="flex-shrink-0 flex items-center">
              <span class="text-2xl font-black tracking-tighter bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent drop-shadow-sm">
                SNAPMGR
              </span>
            </div>
            <div class="hidden sm:flex sm:space-x-1">
              <router-link to="/" 
                class="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
                active-class="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                Dashboard
              </router-link>
              <router-link to="/server" 
                class="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
                active-class="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                Configuration
              </router-link>
              <router-link to="/config/modular" 
                class="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
                active-class="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                Advanced
              </router-link>
              <router-link to="/logs" 
                class="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all duration-200"
                active-class="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                Logs
              </router-link>
            </div>
          </div>
          <div class="flex items-center space-x-4">
            <button @click="logout" class="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-all duration-200">
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <slot></slot>
    </main>
  </div>
</template>
