<script setup lang="ts">
import { ref } from 'vue';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const uiStore = useUIStore();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const isSavingPassword = ref(false);
const isExporting = ref(false);

const handleChangePassword = async () => {
  if (newPassword.value !== confirmPassword.value) {
    uiStore.showToast('Passwords do not match', 'error');
    return;
  }
  if (!currentPassword.value || !newPassword.value) {
    uiStore.showToast('Current and new passwords are required', 'error');
    return;
  }
  isSavingPassword.value = true;
  try {
    await fetchApi('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    });
    uiStore.showToast('Password changed successfully', 'success');
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (err: any) {
    uiStore.showToast(err.message || 'Failed to change password', 'error');
  } finally {
    isSavingPassword.value = false;
  }
};

const handleExportBackup = async () => {
    isExporting.value = true;
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/system/export', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        const contentDisposition = response.headers.get('content-disposition');
        let filename = `snapcast-backup-${Date.now()}.tar.gz`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            if (filenameMatch && filenameMatch.length === 2) {
                filename = filenameMatch[1] || filename;
            }
        }

        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        uiStore.showToast('Backup downloaded successfully', 'success');
    } catch (e: any) {
        uiStore.showToast(e.message || 'Failed to download backup', 'error');
    } finally {
        isExporting.value = false;
    }
};
</script>

<template>
  <Layout>
    <div class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <!-- Header -->
      <div>
        <h1 class="text-3xl font-black text-white tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">Security</h1>
        <p class="text-gray-400 font-medium mt-1">Admin access and server backup.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Change Password -->
        <Card title="Change Administrator Password">
          <template #icon>
            <span class="material-symbols-outlined text-[20px] text-[#ff2a5f] drop-shadow-[0_0_5px_rgba(255,42,95,0.5)]">lock</span>
          </template>
          <div class="space-y-5">
            <div>
              <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Current Password</label>
              <input v-model="currentPassword" type="password" placeholder="Enter current password"
                class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-[#ff2a5f]/30 focus:border-[#ff2a5f] outline-none transition-all text-gray-300 placeholder-gray-600">
            </div>
            <div>
              <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">New Password</label>
              <input v-model="newPassword" type="password" placeholder="Enter new password"
                class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-[#ff2a5f]/30 focus:border-[#ff2a5f] outline-none transition-all text-gray-300 placeholder-gray-600">
            </div>
            <div>
              <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-2">Confirm New Password</label>
              <input v-model="confirmPassword" type="password" placeholder="Re-enter new password"
                class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-[#ff2a5f]/30 focus:border-[#ff2a5f] outline-none transition-all text-gray-300 placeholder-gray-600">
            </div>
            <button
              @click="handleChangePassword"
              :disabled="isSavingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword"
              class="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-[#ff2a5f] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#ff154d] border border-[#ff2a5f] shadow-[0_0_15px_rgba(255,42,95,0.4)] hover:shadow-[0_0_20px_rgba(255,42,95,0.6)] disabled:opacity-50 transition-all active:scale-95"
            >
              <span v-if="isSavingPassword" class="material-symbols-outlined text-[16px] animate-spin">sync</span>
              <span>Update Password</span>
            </button>
          </div>
        </Card>

        <!-- Export Backup -->
        <Card title="Export Server Backup">
          <template #icon>
            <span class="material-symbols-outlined text-[20px] text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">download</span>
          </template>
          <div class="space-y-5">
            <p class="text-sm font-medium text-gray-400 leading-relaxed">
              Download a complete backup of your Snapcast Manager configuration.
              This <span class="text-[#00ff9d] font-bold drop-shadow-[0_0_5px_rgba(0,255,157,0.2)]">.tar.gz</span> archive includes:
            </p>
            <ul class="text-xs font-semibold text-gray-300 space-y-3 mb-6">
              <li class="flex items-center"><span class="material-symbols-outlined text-[16px] mr-2 text-brand-primary">security</span> Administrator Account</li>
              <li class="flex items-center"><span class="material-symbols-outlined text-[16px] mr-2 text-[#00d4ff]">history</span> Saved Snapshots</li>
              <li class="flex items-center"><span class="material-symbols-outlined text-[16px] mr-2 text-[#ff2a5f]">tune</span> Snapserver Configuration</li>
            </ul>

            <div class="bg-amber-500/5 border border-amber-500/20 p-4 rounded-xl">
              <p class="text-[10px] font-black text-amber-500 uppercase tracking-widest">Restore Instructions</p>
              <p class="text-xs text-amber-400/80 mt-1">Keep this file safe. When reinstalling Snapcast Manager on a new device, you can use the flag <code class="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono border border-amber-500/10">--restore /path/to/backup.tar.gz</code> during setup to restore everything magically.</p>
            </div>

            <button
              @click="handleExportBackup"
              :disabled="isExporting"
              class="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-[#00ff9d]/10 text-[#00ff9d] border border-[#00ff9d]/30 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#00ff9d] hover:text-black shadow-[0_0_15px_rgba(0,255,157,0.2)] hover:shadow-[0_0_20px_rgba(0,255,157,0.5)] disabled:opacity-50 transition-all active:scale-95 mt-4"
            >
              <span v-if="isExporting" class="material-symbols-outlined text-[16px] animate-spin">sync</span>
              <span v-else class="material-symbols-outlined text-[16px]">download</span>
              <span>Download Backup</span>
            </button>
          </div>
        </Card>
      </div>
    </div>
  </Layout>
</template>
