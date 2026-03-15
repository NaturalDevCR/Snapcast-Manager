<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchApi } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';
import { 
    RocketLaunchIcon, 
    UserPlusIcon, 
    LockClosedIcon, 
    CheckCircleIcon 
} from '@heroicons/vue/24/outline';

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
    <div class="min-h-screen bg-slate-50 dark:bg-[#0f172a] flex items-center justify-center p-6 transition-colors duration-500">
        <!-- Background Accents -->
        <div class="fixed inset-0 overflow-hidden pointer-events-none">
            <div class="absolute -top-[15%] -right-[5%] w-[50%] h-[50%] bg-blue-500/10 blur-[120px] rounded-full"></div>
            <div class="absolute -bottom-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full"></div>
        </div>

        <div class="max-w-xl w-full relative group">
            <!-- Glow Effect -->
            <div class="absolute -inset-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 rounded-[2.5rem] blur opacity-15 group-hover:opacity-25 transition duration-1000"></div>
            
            <div class="relative bg-white dark:bg-slate-900 shadow-2xl rounded-[2.5rem] p-8 md:p-14 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-1000">
                <div class="text-center mb-12">
                     <div class="inline-flex items-center justify-center p-5 bg-blue-500/10 rounded-3xl mb-8">
                        <RocketLaunchIcon class="h-12 w-12 text-blue-600 dark:text-blue-400" />
                     </div>
                     <h2 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight leading-tight mb-4">
                        System Ignition
                    </h2>
                    <p class="text-slate-500 dark:text-slate-400 font-medium text-lg">
                        Let's set up your master administrator account.
                    </p>
                </div>

                <form class="space-y-8" @submit.prevent="handleSetup">
                    <div class="space-y-5">
                        <div class="group/input">
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 block px-2 group-focus-within/input:text-blue-500 transition-colors">Admin Username</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                    <UserPlusIcon class="h-5 w-5 text-slate-400 group-focus-within/input:text-blue-500 transition-colors" />
                                </div>
                                <input 
                                    v-model="username" 
                                    type="text" 
                                    required
                                    class="block w-full pl-12 pr-6 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-bold"
                                    placeholder="Choose username..." 
                                />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div class="group/input">
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 block px-2 group-focus-within/input:text-indigo-500 transition-colors">Password</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                        <LockClosedIcon class="h-5 w-5 text-slate-400 group-focus-within/input:text-indigo-500 transition-colors" />
                                    </div>
                                    <input 
                                        v-model="password" 
                                        type="password" 
                                        required
                                        class="block w-full pl-12 pr-6 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all font-bold"
                                        placeholder="Min 8 chars" 
                                    />
                                </div>
                            </div>
                            <div class="group/input">
                                <label class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 block px-2 group-focus-within/input:text-purple-500 transition-colors">Confirm</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                        <CheckCircleIcon class="h-5 w-5 text-slate-400 group-focus-within/input:text-purple-500 transition-colors" />
                                    </div>
                                    <input 
                                        v-model="confirmPassword" 
                                        type="password" 
                                        required
                                        class="block w-full pl-12 pr-6 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 outline-none transition-all font-bold"
                                        placeholder="Repeat password" 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        :disabled="loading"
                        class="w-full flex items-center justify-center py-5 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-indigo-500/30 transition-all hover:-translate-y-1 active:scale-[0.98] disabled:opacity-50"
                    >
                        <span v-if="loading" class="flex items-center">
                            <ArrowPathIcon class="h-5 w-5 mr-3 animate-spin" />
                            Initializing System...
                        </span>
                        <span v-else>Complete Setup & Launch</span>
                    </button>
                    
                    <p class="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed px-4">
                        By completing setup, you become the primary controller of this Snapcast infrastructure instance.
                    </p>
                </form>
            </div>
        </div>
    </div>
</template>
