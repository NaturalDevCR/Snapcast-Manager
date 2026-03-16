<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchApi } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const router = useRouter();
const authStore = useAuthStore();
const uiStore = useUIStore();

const handleSetup = async () => {
    if (password.value !== confirmPassword.value) {
        uiStore.showToast('Passwords do not match', 'warning');
        return;
    }

    loading.value = true;
    try {
        const data = await fetchApi('/auth/setup', {
            method: 'POST',
            body: JSON.stringify({
                username: username.value,
                password: password.value,
            }),
        });
        
        // Auto-login logic
        authStore.token = data.token;
        authStore.user = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        uiStore.showToast('System initialized! Welcome aboard.', 'success');
        router.push('/');
    } catch (err: any) {
        uiStore.showToast(err.message || 'Setup failed', 'error');
    } finally {
        loading.value = false;
    }
};
</script>

<template>
    <div class="min-h-screen bg-brand-bg flex items-center justify-center p-6 transition-colors duration-500">
        <!-- Background Accents -->
        <div class="fixed inset-0 overflow-hidden pointer-events-none">
            <div class="absolute -top-[15%] -right-[5%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full"></div>
            <div class="absolute -bottom-[10%] -left-[10%] w-[40%] h-[40%] bg-brand-primary/10 blur-[120px] rounded-full"></div>
        </div>

        <div class="max-w-xl w-full relative group">
            <!-- Glow Effect -->
            <div class="absolute -inset-1 bg-brand-primary/20 rounded-[2.5rem] blur opacity-15 group-hover:opacity-30 transition duration-1000"></div>
            
            <div class="relative bg-black/40 shadow-2xl rounded-[2.5rem] p-8 md:p-14 border border-white/5 backdrop-blur-xl animate-in fade-in zoom-in duration-1000">
                <div class="text-center mb-12">
                     <div class="inline-flex items-center justify-center p-5 bg-brand-primary/10 rounded-3xl mb-8 border border-brand-primary/20 shadow-[inset_0_0_15px_rgba(166,13,242,0.1)]">
                        <span class="material-symbols-outlined text-[3rem] text-brand-primary drop-shadow-[0_0_15px_rgba(166,13,242,0.4)]">rocket_launch</span>
                     </div>
                     <h2 class="text-4xl font-black text-white tracking-tight leading-tight mb-4 drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                        System Ignition
                    </h2>
                    <p class="text-slate-500 dark:text-slate-400 font-medium text-lg">
                        Let's set up your master administrator account.
                    </p>
                </div>

                <form class="space-y-8" @submit.prevent="handleSetup">
                    <div class="space-y-5">
                        <div class="group/input">
                            <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2 block px-2 group-focus-within/input:text-brand-primary transition-colors">Admin Username</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                    <span class="material-symbols-outlined text-gray-400 group-focus-within/input:text-brand-primary transition-colors text-[1.2rem]">person_add</span>
                                </div>
                                <input 
                                    v-model="username" 
                                    type="text" 
                                    required
                                    class="block w-full pl-12 pr-6 py-4 bg-black/40 border border-white/5 rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-bold"
                                    placeholder="Choose username..." 
                                />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div class="group/input">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2 block px-2 group-focus-within/input:text-brand-primary transition-colors">Password</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                        <span class="material-symbols-outlined text-gray-400 group-focus-within/input:text-brand-primary transition-colors text-[1.2rem]">lock</span>
                                    </div>
                                    <input 
                                        v-model="password" 
                                        type="password" 
                                        required
                                        class="block w-full pl-12 pr-6 py-4 bg-black/40 border border-white/5 rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-bold"
                                        placeholder="Min 8 chars" 
                                    />
                                </div>
                            </div>
                            <div class="group/input">
                                <label class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2 block px-2 group-focus-within/input:text-brand-primary transition-colors">Confirm</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                        <span class="material-symbols-outlined text-gray-400 group-focus-within/input:text-brand-primary transition-colors text-[1.2rem]">check_circle</span>
                                    </div>
                                    <input 
                                        v-model="confirmPassword" 
                                        type="password" 
                                        required
                                        class="block w-full pl-12 pr-6 py-4 bg-black/40 border border-white/5 rounded-2xl text-white placeholder-gray-500 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-bold"
                                        placeholder="Repeat password" 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        :disabled="loading"
                        class="w-full flex items-center justify-center py-5 px-8 bg-brand-primary hover:bg-[#8e0bc9] text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(166,13,242,0.4)] border border-brand-primary/50 hover:shadow-[0_0_25px_rgba(166,13,242,0.6)] transition-all hover:-translate-y-1 active:scale-[0.98] disabled:opacity-50"
                    >
                        <span v-if="loading" class="flex items-center gap-2">
                            <span class="material-symbols-outlined animate-spin text-[1.2rem]">sync</span>
                            Initializing System...
                        </span>
                        <span v-else>Complete Setup & Launch</span>
                    </button>
                    
                    <p class="text-center text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-relaxed px-4">
                        By completing setup, you become the primary controller of this Snapcast infrastructure instance.
                    </p>
                </form>
            </div>
        </div>
    </div>
</template>
