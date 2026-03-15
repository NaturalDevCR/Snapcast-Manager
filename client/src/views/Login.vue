<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';
import { useRouter } from 'vue-router';
import { LockClosedIcon, UserIcon, ArrowRightIcon } from '@heroicons/vue/24/outline';

const username = ref('');
const password = ref('');
const loading = ref(false);
const authStore = useAuthStore();
const uiStore = useUIStore();
const router = useRouter();

const handleLogin = async () => {
  loading.value = true;
  try {
    await authStore.login(username.value, password.value);
    uiStore.showToast('Welcome back!', 'success');
    router.push('/');
  } catch (err: any) {
    uiStore.showToast(err.message || 'Authentication failed', 'error');
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 dark:bg-[#0f172a] flex items-center justify-center p-6 transition-colors duration-500">
    <!-- Background Accents -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none">
        <div class="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
        <div class="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full"></div>
    </div>

    <div class="max-w-md w-full relative group">
      <!-- Glow Effect -->
      <div class="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[2.5rem] blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
      
      <div class="relative bg-white dark:bg-slate-900 shadow-2xl rounded-[2rem] p-8 md:p-12 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-700">
        <div class="text-center mb-10">
           <div class="inline-flex items-center justify-center p-4 bg-indigo-500/10 rounded-2xl mb-6">
              <LockClosedIcon class="h-10 w-10 text-indigo-600 dark:text-indigo-400" />
           </div>
           <h2 class="text-3xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
            Snapcast Manager
          </h2>
          <p class="mt-2 text-slate-500 dark:text-slate-400 font-medium">Please enter your credentials.</p>
        </div>

        <form class="space-y-6" @submit.prevent="handleLogin">
          <div class="space-y-4">
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <UserIcon class="h-5 w-5 text-slate-400" />
              </div>
              <input 
                id="username" 
                type="text" 
                required 
                v-model="username" 
                class="block w-full pl-11 pr-4 py-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium"
                placeholder="Username"
              >
            </div>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <LockClosedIcon class="h-5 w-5 text-slate-400" />
              </div>
              <input 
                id="password" 
                type="password" 
                required 
                v-model="password"
                class="block w-full pl-11 pr-4 py-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-medium"
                placeholder="Password"
              >
            </div>
          </div>

          <button 
            type="submit" 
            :disabled="loading"
            class="group w-full flex items-center justify-center py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <span v-if="loading" class="animate-pulse">Authenticating...</span>
            <div v-else class="flex items-center">
                <span>Sign In</span>
                <ArrowRightIcon class="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        </form>

        <div class="mt-10 text-center">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em]">
                &copy; 2026 Snapcast Manager
            </p>
        </div>
      </div>
    </div>
  </div>
</template>
