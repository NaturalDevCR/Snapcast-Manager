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
    <main class="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 min-h-[calc(100vh-64px-100px)]">
      <slot></slot>
    </main>

    <!-- Footer -->
    <footer class="py-10 text-center border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
      <div class="flex flex-col items-center justify-center space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400 font-medium">
          Made with <span class="text-red-500 animate-pulse inline-block">❤️</span> by 
          <a href="https://github.com/NaturalDevCR" target="_blank" rel="noopener noreferrer" class="text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors font-bold">
            NaturalDevCR
          </a>
        </p>
        <a href="https://www.paypal.com/paypalme/NaturalCloud" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center space-x-2 px-5 py-2.5 bg-[#ffc439] hover:bg-[#fbdca8] text-slate-900 text-xs font-black tracking-widest uppercase rounded-xl transition-all duration-300 shadow-sm hover:shadow-md active:scale-95">
          <svg viewBox="0 0 100 100" class="w-4 h-4" xmlns="http://www.w3.org/2000/svg"><path d="M84.2,34.1c-1.3-6.1-5.8-9.6-13.3-10.4c-1.6-0.2-3.3-0.2-5.1-0.2H41.5c-2.3,0-4.3,1.6-4.7,3.9 l-8.9,56.5c-0.2,1.1,0.7,2.1,1.8,2.1h15.2c1.7,0,3.2-1.3,3.5-3l1.8-11.3c0.4-2.2,2.3-3.8,4.5-3.8h5.3c11.4,0,19.2-4.6,21.5-13.8 C85.4,47.4,85.1,40.1,84.2,34.1z" fill="#003087"/><path d="M37.3,18.4c-0.4-2.3,1.4-4.4,3.7-4.4h23.1c11.8,0,19.1,4.7,21.1,13.8c1,4.6,0.7,9.6-1,14.4H65.8 c-10,0-17.2,5.5-19.3,15.7l-2.4,14.8H29L37.3,18.4z" fill="#0079C1"/></svg>
          <span>Donate</span>
        </a>
      </div>
    </footer>
  </div>
</template>
