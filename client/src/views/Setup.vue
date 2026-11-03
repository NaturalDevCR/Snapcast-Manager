<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { fetchApi } from '../utils/api';
import { useAuthStore } from '../stores/auth';
import { useUIStore } from '../stores/ui';

const { t } = useI18n({ useScope: 'global' });
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const router = useRouter();
const authStore = useAuthStore();
const uiStore = useUIStore();

const handleSetup = async () => {
    if (password.value !== confirmPassword.value) {
        uiStore.showToast(t('setup.passwordMismatch'), 'warning');
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

        uiStore.showToast(t('setup.successToast'), 'success');
        router.push('/onboarding');
    } catch (err: any) {
        uiStore.showToast(err.message || t('setup.failureToast'), 'error');
    } finally {
        loading.value = false;
    }
};
</script>

<template>
    <div class="min-h-screen bg-brand-bg flex items-center justify-center p-6 transition-colors duration-500">
        <!-- Background Accents -->
        <div class="fixed inset-0 overflow-hidden pointer-events-none">
            <div class="absolute -top-[15%] -right-[5%] w-[50%] h-[50%] bg-brand-primary/10 blur-[120px] rounded-full"></div>
            <div class="absolute -bottom-[10%] -left-[10%] w-[40%] h-[40%] bg-brand-primary/10 blur-[120px] rounded-full"></div>
        </div>

        <div class="max-w-xl w-full relative group">
            <!-- Glow Effect -->
            <div class="absolute -inset-1 bg-brand-primary/20 rounded-3xl blur opacity-15 group-hover:opacity-30 transition duration-1000"></div>

            <div class="relative bg-brand-surface/80 backdrop-blur-3xl shadow-2xl rounded-3xl p-6 sm:p-10 border border-line animate-in fade-in zoom-in duration-1000">
                <div class="text-center mb-8">
                     <div class="inline-flex items-center justify-center p-5 bg-brand-primary/10 rounded-3xl mb-8 border border-brand-primary/20">
                        <span class="material-symbols-outlined text-[3rem] text-brand-primary">rocket_launch</span>
                     </div>
                     <h2 class="text-2xl sm:text-3xl font-bold text-text-main tracking-tight mb-2">
                        {{ t('setup.title') }}
                    </h2>
                    <p class="text-text-muted text-base">
                        {{ t('setup.subtitle') }}
                    </p>
                </div>

                <form class="space-y-8" @submit.prevent="handleSetup">
                    <div class="space-y-5">
                        <div class="group/input">
                            <label class="text-xs font-semibold text-text-muted mb-1.5 block px-1 group-focus-within/input:text-brand-primary transition-colors">{{ t('setup.usernameLabel') }}</label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                    <span class="material-symbols-outlined text-text-muted group-focus-within/input:text-brand-primary transition-colors text-[1.2rem]">person_add</span>
                                </div>
                                <input
                                    v-model="username"
                                    type="text"
                                    autocomplete="username"
                                    required
                                    class="block w-full pl-12 pr-4 py-3 bg-inset border border-line rounded-xl text-text-main placeholder:text-text-muted/70 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                                    :placeholder="t('setup.usernamePlaceholder')"
                                />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div class="group/input">
                                <label class="text-xs font-semibold text-text-muted mb-1.5 block px-1 group-focus-within/input:text-brand-primary transition-colors">{{ t('setup.passwordLabel') }}</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                        <span class="material-symbols-outlined text-text-muted group-focus-within/input:text-brand-primary transition-colors text-[1.2rem]">lock</span>
                                    </div>
                                    <input
                                        v-model="password"
                                        type="password"
                                        autocomplete="new-password"
                                        required
                                        class="block w-full pl-12 pr-4 py-3 bg-inset border border-line rounded-xl text-text-main placeholder:text-text-muted/70 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                                        :placeholder="t('setup.passwordPlaceholder')"
                                    />
                                </div>
                            </div>
                            <div class="group/input">
                                <label class="text-xs font-semibold text-text-muted mb-1.5 block px-1 group-focus-within/input:text-brand-primary transition-colors">{{ t('setup.confirmLabel') }}</label>
                                <div class="relative">
                                    <div class="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                                        <span class="material-symbols-outlined text-text-muted group-focus-within/input:text-brand-primary transition-colors text-[1.2rem]">check_circle</span>
                                    </div>
                                    <input
                                        v-model="confirmPassword"
                                        type="password"
                                        autocomplete="new-password"
                                        required
                                        class="block w-full pl-12 pr-4 py-3 bg-inset border border-line rounded-xl text-text-main placeholder:text-text-muted/70 focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 outline-none transition-all font-medium"
                                        :placeholder="t('setup.confirmPlaceholder')"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        :disabled="loading"
                        class="w-full flex items-center justify-center py-3 px-6 bg-brand-primary hover:bg-brand-primary/85 text-white rounded-xl font-semibold text-sm shadow-sm transition-colors active:scale-[0.98] disabled:opacity-50"
                    >
                        <span v-if="loading" class="flex items-center gap-2">
                            <span class="material-symbols-outlined animate-spin text-[1.2rem]">sync</span>
                            {{ t('setup.initializing') }}
                        </span>
                        <span v-else>{{ t('setup.submit') }}</span>
                    </button>

                    <p class="text-center text-xs text-text-muted leading-relaxed px-4">
                        {{ t('setup.footer') }}
                    </p>
                </form>
            </div>
        </div>
    </div>
</template>
