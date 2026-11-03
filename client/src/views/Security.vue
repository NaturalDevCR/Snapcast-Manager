<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUIStore } from '../stores/ui';
import { fetchApi } from '../utils/api';
import Layout from '../components/Layout.vue';
import Button from '../components/ui/Button.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import Card from '../components/Card.vue';

const { t } = useI18n({ useScope: 'global' });
const uiStore = useUIStore();

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const isSavingPassword = ref(false);
const isExporting = ref(false);

// Only flag a mismatch once the confirmation has been typed, not while the
// user is still filling in the first field.
const passwordMismatch = computed(() => !!confirmPassword.value && newPassword.value !== confirmPassword.value);

const passwordFields = computed(() => [
  { id: 'current-password', model: currentPassword, label: t('security.currentPasswordLabel'), placeholder: t('security.currentPasswordPlaceholder'), autocomplete: 'current-password', invalid: false },
  { id: 'new-password', model: newPassword, label: t('security.newPasswordLabel'), placeholder: t('security.newPasswordPlaceholder'), autocomplete: 'new-password', invalid: false },
  { id: 'confirm-password', model: confirmPassword, label: t('security.confirmPasswordLabel'), placeholder: t('security.confirmPasswordPlaceholder'), autocomplete: 'new-password', invalid: passwordMismatch.value },
]);

const handleChangePassword = async () => {
  if (newPassword.value !== confirmPassword.value) {
    uiStore.showToast(t('security.passwordsMismatch'), 'error');
    return;
  }
  if (!currentPassword.value || !newPassword.value) {
    uiStore.showToast(t('security.passwordRequired'), 'error');
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
    uiStore.showToast(t('security.passwordChanged'), 'success');
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (err: any) {
    uiStore.showToast(err.message || t('security.changePasswordFailed'), 'error');
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
            throw new Error(t('security.exportFailed', { status: response.statusText }));
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

        uiStore.showToast(t('security.backupDownloaded'), 'success');
    } catch (e: any) {
        uiStore.showToast(e.message || t('security.downloadBackupFailed'), 'error');
    } finally {
        isExporting.value = false;
    }
};
</script>

<template>
  <Layout>
    <PageHeader :title="t('security.title')" :description="t('security.subtitle')" />

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <!-- Change Password -->
      <Card :title="t('security.changePasswordTitle')">
        <template #icon>
          <span class="material-symbols-outlined text-[1.2rem]">lock</span>
        </template>
        <form class="space-y-4" @submit.prevent="handleChangePassword">
          <div v-for="field in passwordFields" :key="field.id">
            <label :for="field.id" class="block text-xs font-semibold text-text-muted mb-1.5">{{ field.label }}</label>
            <input
              :id="field.id"
              v-model="field.model.value"
              type="password"
              :autocomplete="field.autocomplete"
              :placeholder="field.placeholder"
              :aria-invalid="field.invalid || undefined"
              :class="field.invalid ? 'border-danger focus:ring-danger/30 focus:border-danger' : 'border-line focus:ring-brand-primary/30 focus:border-brand-primary'"
              class="w-full text-sm px-3.5 py-2.5 bg-inset border rounded-xl focus:ring-2 outline-none transition-colors text-text-main placeholder:text-text-muted/60"
            >
          </div>
          <p v-if="passwordMismatch" class="text-xs text-danger" role="alert">{{ t('security.passwordMismatch') }}</p>
          <Button
            type="submit"
            class="w-full"
            :loading="isSavingPassword"
            :disabled="!currentPassword || !newPassword || newPassword !== confirmPassword"
          >{{ t('security.updatePassword') }}</Button>
        </form>
      </Card>

      <!-- Export Backup -->
      <Card :title="t('security.exportTitle')">
        <template #icon>
          <span class="material-symbols-outlined text-[1.2rem]">download</span>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-text-muted leading-relaxed">
            <i18n-t keypath="security.exportDescription">
              <template #archive><code class="font-mono text-text-main">.tar.gz</code></template>
            </i18n-t>
          </p>
          <ul class="text-sm text-text-main space-y-2">
            <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[1.1rem] text-success" aria-hidden="true">check_circle</span> {{ t('security.administratorAccount') }}</li>
            <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[1.1rem] text-success" aria-hidden="true">check_circle</span> {{ t('security.savedSnapshots') }}</li>
            <li class="flex items-center gap-2"><span class="material-symbols-outlined text-[1.1rem] text-success" aria-hidden="true">check_circle</span> {{ t('security.snapserverConfig') }}</li>
          </ul>

          <div class="rounded-xl border border-info/25 bg-info/10 p-4">
            <p class="text-xs font-semibold text-text-main">{{ t('security.restoreInstructions') }}</p>
            <p class="text-xs text-text-muted mt-1 leading-relaxed">
              <i18n-t keypath="security.restoreInstructionsBody">
                <template #flag><code class="bg-inset px-1 py-0.5 rounded text-text-main font-mono border border-line">--restore /path/to/backup.tar.gz</code></template>
              </i18n-t>
            </p>
          </div>

          <Button variant="subtle" class="w-full" :loading="isExporting" @click="handleExportBackup">
            <span v-if="!isExporting" class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">download</span>
            {{ t('security.downloadBackup') }}
          </Button>
        </div>
      </Card>
    </div>
  </Layout>
</template>
