<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';
import { useRouter } from 'vue-router';

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
  <div class="min-h-screen bg-brand-bg flex items-center justify-center p-6 transition-colors duration-500">
    <!-- Background Accents -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none">
        <div class="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-brand-primary/10 blur-[120px] rounded-full"></div>
        <div class="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
    </div>

    <div class="max-w-md w-full relative group">
      <div class="relative bg-brand-surface shadow-lg rounded-2xl p-6 md:p-8 border border-white/10 animate-in fade-in zoom-in duration-700">
        <div class="text-center mb-8">
           <div class="inline-flex items-center justify-center mb-4">
              <img src="../assets/logo.png" alt="Logo" class="w-16 h-16 rounded-xl shadow-md object-cover border border-white/5" />
           </div>
           <h2 class="text-2xl font-black text-text-main tracking-tight leading-tight">
            Snapcast Manager
          </h2>
          <p class="mt-2 text-sm text-text-muted font-medium">Please enter your credentials.</p>
        </div>

        <form class="space-y-6" @submit.prevent="handleLogin">
          <div class="space-y-4">
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span class="material-symbols-outlined text-gray-400 text-lg">person</span>
              </div>
              <input 
                id="username" 
                type="text" 
                required 
                v-model="username" 
                class="block w-full pl-11 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-sm text-text-main placeholder-text-muted focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                placeholder="Username"
              >
            </div>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span class="material-symbols-outlined text-gray-400 text-lg">key</span>
              </div>
              <input 
                id="password" 
                type="password" 
                required 
                v-model="password"
                class="block w-full pl-11 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-sm text-text-main placeholder-text-muted focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                placeholder="Password"
              >
            </div>
          </div>

          <button 
            type="submit" 
            :disabled="loading"
            class="group w-full flex items-center justify-center py-3 px-6 bg-brand-primary hover:bg-blue-600 text-white rounded-xl font-bold text-sm uppercase tracking-widest shadow-sm shadow-brand-primary/10 border border-brand-primary transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <span v-if="loading" class="animate-pulse flex items-center gap-2"><span class="material-symbols-outlined animate-spin text-lg">sync</span>Authenticating...</span>
            <div v-else class="flex items-center">
                <span>Sign In</span>
                <span class="material-symbols-outlined ml-2 group-hover:translate-x-1 transition-transform text-lg">login</span>
            </div>
          </button>
        </form>

      </div>
    </div>
  </div>
</template>
