<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchApi } from '../utils/api';

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const error = ref('');
const router = useRouter();

const handleSetup = async () => {
    if (password.value !== confirmPassword.value) {
        error.value = 'Passwords do not match';
        return;
    }

    loading.value = true;
    error.value = '';

    try {
        await fetchApi('/auth/setup', {
            method: 'POST',
            body: JSON.stringify({
                username: username.value,
                password: password.value,
            }),
        });
        
        alert('System initialized successfully! Please log in.');
        router.push('/login');
    } catch (err: any) {
        error.value = err.message || 'Setup failed';
    } finally {
        loading.value = false;
    }
};
</script>

<template>
    <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8 p-10 bg-white dark:bg-gray-800 rounded-2xl shadow-xl">
            <div>
                <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
                    Initial Setup
                </h2>
                <p class="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
                    Create your administrator account to get started.
                </p>
            </div>
            <form class="mt-8 space-y-6" @submit.prevent="handleSetup">
                <div v-if="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
                    {{ error }}
                </div>
                <div class="rounded-md shadow-sm -space-y-px">
                    <div>
                        <label for="username" class="sr-only">Username</label>
                        <input v-model="username" id="username" name="username" type="text" required
                            class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm dark:bg-gray-900"
                            placeholder="Username" />
                    </div>
                    <div>
                        <label for="password" class="sr-only">Password</label>
                        <input v-model="password" id="password" name="password" type="password" required
                            class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm dark:bg-gray-900"
                            placeholder="Password" />
                    </div>
                    <div>
                        <label for="confirm-password" class="sr-only">Confirm Password</label>
                        <input v-model="confirmPassword" id="confirm-password" name="confirm-password" type="password" required
                            class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm dark:bg-gray-900"
                            placeholder="Confirm Password" />
                    </div>
                </div>

                <div>
                    <button type="submit" :disabled="loading"
                        class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                        {{ loading ? 'Initializing...' : 'Get Started' }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>
