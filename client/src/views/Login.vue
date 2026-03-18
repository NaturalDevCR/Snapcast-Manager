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
      <!-- Glow Effect -->
      <div class="absolute -inset-1 bg-brand-primary/20 rounded-[2.5rem] blur opacity-20 group-hover:opacity-40 transition duration-1000"></div>
      
      <div class="relative bg-black/40 shadow-2xl rounded-[2rem] p-8 md:p-12 border border-white/5 backdrop-blur-xl animate-in fade-in zoom-in duration-700">
        <div class="text-center mb-10">
           <div class="inline-flex items-center justify-center mb-6">
              <img src="../assets/logo.png" alt="Logo" class="w-20 h-20 rounded-2xl shadow-xl object-cover" />
           </div>
           <h2 class="text-3xl font-black text-white tracking-tight leading-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
            Snapcast Manager
          </h2>
          <p class="mt-2 text-gray-400 font-medium">Please enter your credentials.</p>
        </div>

        <form class="space-y-6" @submit.prevent="handleLogin">
          <div class="space-y-4">
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span class="material-symbols-outlined text-gray-400 text-[1.2rem]">person</span>
              </div>
              <input 
                id="username" 
                type="text" 
                required 
                v-model="username" 
                class="block w-full pl-11 pr-4 py-3.5 bg-black/40 border border-white/5 rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                placeholder="Username"
              >
            </div>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span class="material-symbols-outlined text-gray-400 text-[1.2rem]">key</span>
              </div>
              <input 
                id="password" 
                type="password" 
                required 
                v-model="password"
                class="block w-full pl-11 pr-4 py-3.5 bg-black/40 border border-white/5 rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                placeholder="Password"
              >
            </div>
          </div>

          <button 
            type="submit" 
            :disabled="loading"
            class="group w-full flex items-center justify-center py-4 px-6 bg-brand-primary hover:bg-[#8e0bc9] text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-[0_0_15px_rgba(166,13,242,0.4)] border border-brand-primary/50 hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <span v-if="loading" class="animate-pulse flex items-center gap-2"><span class="material-symbols-outlined animate-spin text-[1.2rem]">sync</span>Authenticating...</span>
            <div v-else class="flex items-center">
                <span>Sign In</span>
                <span class="material-symbols-outlined ml-2 group-hover:translate-x-1 transition-transform text-[1.2rem]">login</span>
            </div>
          </button>
        </form>

      </div>
    </div>
  </div>
</template>
