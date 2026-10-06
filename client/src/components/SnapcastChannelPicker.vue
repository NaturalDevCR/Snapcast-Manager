<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fetchApi } from '../utils/api';
import { useSystemStore } from '../stores/system';

const props = defineProps<{ pkg: 'snapserver' | 'snapclient' }>();
const { t } = useI18n();
const system = useSystemStore();
const channel = ref<'official' | 'beta'>('official');
const tag = ref('');
const busy = ref(false);
const error = ref('');
const installedVersion = ref('');
const releases = ref<{ tag: string; name: string; notes: string; url: string }[]>([]);
const selected = computed(
  () => releases.value.find((r) => r.tag === tag.value) || releases.value[0],
);
const ready = computed(() => channel.value === 'official' || releases.value.length > 0);

async function loadReleases() {
  releases.value = (await fetchApi(`/system/snapcast-releases/${props.pkg}`)).releases;
}
async function save() {
  await fetchApi(`/system/snapcast-channels/${props.pkg}`, {
    method: 'POST',
    body: JSON.stringify({
      channel: channel.value,
      ...(channel.value === 'beta' && tag.value ? { tag: tag.value } : {}),
    }),
  });
}
async function changeChannel() {
  busy.value = true;
  error.value = '';
  tag.value = '';
  try {
    if (channel.value === 'beta') await loadReleases();
    await save();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
async function changeVersion() {
  busy.value = true;
  error.value = '';
  try {
    await save();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
async function install() {
  busy.value = true;
  error.value = '';
  try {
    await save();
    // Always preserve configuration, including when returning to official.
    await system.updatePackage(props.pkg, false);
    installedVersion.value =
      (await fetchApi('/system/snapcast-channels')).installed?.[props.pkg] || '';
  } catch (err: any) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  busy.value = true;
  try {
    const data = await fetchApi('/system/snapcast-channels');
    const prefs = data[props.pkg];
    installedVersion.value = data.installed?.[props.pkg] || '';
    channel.value = prefs.channel;
    tag.value = prefs.tag || '';
    if (channel.value === 'beta') await loadReleases();
  } catch (err: any) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <div class="space-y-3 rounded-xl border border-black/10 dark:border-white/10 p-3">
    <label class="block text-sm font-semibold">
      {{ t('common.snapcastChannel') }}
      <select
        v-model="channel"
        :disabled="busy || system.loading"
        class="mt-1 w-full rounded-lg bg-white dark:bg-gray-900 p-2"
        @change="changeChannel"
      >
        <option value="official">{{ t('common.snapcastOfficial') }}</option>
        <option value="beta">{{ t('common.snapcastBeta') }}</option>
      </select>
    </label>
    <template v-if="channel === 'beta'">
      <label class="block text-sm">
        {{ t('common.snapcastVersion') }}
        <select
          v-model="tag"
          :disabled="busy || system.loading"
          class="mt-1 w-full rounded-lg bg-white dark:bg-gray-900 p-2"
          @change="changeVersion"
        >
          <option value="">{{ t('common.snapcastLatestBeta') }}</option>
          <option v-for="release in releases" :key="release.tag" :value="release.tag">
            {{ release.tag }}
          </option>
        </select>
      </label>
      <p v-if="!busy && !releases.length" class="text-xs text-text-muted">
        {{ t('common.snapcastNoBeta') }}
      </p>
      <p v-if="selected" class="text-xs text-text-muted">{{ selected.tag }}</p>
      <details v-if="selected?.notes" class="text-xs">
        <summary>{{ t('common.snapcastChanges') }}</summary>
        <p class="mt-2 whitespace-pre-wrap">{{ selected.notes }}</p>
      </details>
    </template>
    <p v-if="installedVersion && installedVersion !== 'unknown'" class="text-xs text-text-muted">
      {{ t('common.snapcastInstalledVersion') }}: {{ installedVersion }}
    </p>
    <p class="text-xs text-text-muted">{{ t('common.snapcastKeepConfig') }}</p>
    <p v-if="error" role="alert" class="text-xs text-red-500">{{ error }}</p>
    <button
      type="button"
      :disabled="busy || system.loading || !ready"
      class="w-full rounded-lg bg-brand-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      @click="install"
    >
      {{ t(channel === 'beta' ? 'common.snapcastInstallBeta' : 'common.snapcastInstallOfficial') }}
    </button>
  </div>
</template>
