<script setup lang="ts">
// ServiceCard.vue -- UI overhaul (2026-11).
//
// One card shape for every package the Dashboard manages (snapserver,
// AirPlay, MPD, myMPD, FFmpeg, Snap-ctrl). Previously each was hand-written
// with its own vocabulary and colours -- "ABSENT", "DISABLED", "NOT
// INSTALLED" all in alarm red for what is simply an optional package not
// installed yet, Snap-ctrl showing "UPDATE READY" while not installed, and
// four full-width purple buttons stacked per card. Now:
//   - status is one Badge: Not installed (neutral) / Installed / Running
//     (success) / Stopped (warning) / Failed (danger);
//   - there is at most ONE primary button (Install, or Update when a newer
//     version exists);
//   - start/stop/restart are small subtle buttons;
//   - destructive actions (clean reinstall, uninstall) live in an overflow
//     menu instead of sitting next to everyday controls.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/vue';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';

const props = withDefaults(
  defineProps<{
    name: string;
    icon: string;
    description: string;
    installed: boolean;
    /** systemd state; omit for packages with no service of their own (ffmpeg). */
    serviceStatus?: string;
    version?: string;
    availableVersion?: string;
    busy?: boolean;
    canReinstall?: boolean;
    canUninstall?: boolean;
    /** Hide the generic Install button (e.g. snapserver's channel picker owns it). */
    hideInstall?: boolean;
  }>(),
  {
    serviceStatus: undefined,
    version: undefined,
    availableVersion: undefined,
    busy: false,
    canReinstall: false,
    canUninstall: false,
    hideInstall: false,
  },
);

const emit = defineEmits<{
  install: [];
  update: [];
  reinstall: [];
  uninstall: [];
  control: [action: 'start' | 'stop' | 'restart'];
}>();

const { t } = useI18n({ useScope: 'global' });

const hasService = computed(() => props.serviceStatus !== undefined);

const status = computed<{ label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }>(
  () => {
    if (!props.installed) return { label: t('dashboard.statusNotInstalled'), variant: 'neutral' };
    if (!hasService.value) return { label: t('dashboard.statusInstalled'), variant: 'success' };
    if (props.serviceStatus === 'active')
      return { label: t('dashboard.statusRunning'), variant: 'success' };
    if (props.serviceStatus === 'failed')
      return { label: t('dashboard.statusFailed'), variant: 'danger' };
    return { label: t('dashboard.statusStopped'), variant: 'warning' };
  },
);

const knownAvailable = computed(
  () => !!props.availableVersion && props.availableVersion !== 'unknown',
);

const updateAvailable = computed(
  () =>
    props.installed &&
    knownAvailable.value &&
    !!props.version &&
    props.version !== props.availableVersion,
);

const showVersion = computed(
  () => props.installed && !!props.version && props.version !== 'unknown',
);
const isRunning = computed(() => props.serviceStatus === 'active');
const hasMenu = computed(() => props.installed && (props.canReinstall || props.canUninstall));
</script>

<template>
  <div class="flex flex-col rounded-2xl border border-line bg-brand-surface/80 p-5 shadow-sm">
    <div class="flex items-start gap-3">
      <div
        class="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
        :class="
          installed ? 'bg-brand-primary/10 text-brand-primary-text' : 'bg-inset text-text-muted'
        "
      >
        <span class="material-symbols-outlined text-[1.3rem]" aria-hidden="true">{{ icon }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold text-text-main truncate">{{ name }}</h3>
          <Badge :variant="status.variant" size="sm">{{ status.label }}</Badge>
        </div>
        <p class="mt-1 text-xs text-text-muted leading-relaxed">{{ description }}</p>
      </div>
    </div>

    <dl v-if="showVersion" class="mt-4 flex items-center justify-between text-xs">
      <dt class="text-text-muted">{{ t('dashboard.versionLabel') }}</dt>
      <dd class="font-mono text-text-main truncate max-w-[60%]" :title="version">{{ version }}</dd>
    </dl>

    <div
      v-if="updateAvailable"
      class="mt-3 flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
    >
      <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">upgrade</span>
      {{ t('dashboard.newVersionAvailable', { version: availableVersion }) }}
    </div>

    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>

    <div class="mt-auto pt-4 flex flex-wrap items-center gap-2">
      <Button
        v-if="!installed && !hideInstall"
        size="sm"
        :loading="busy"
        @click="emit('install')"
        >{{ t('dashboard.installButton', { name }) }}</Button
      >

      <Button v-if="updateAvailable" size="sm" :disabled="busy" @click="emit('update')">{{
        t('dashboard.updateToButton', { version: availableVersion })
      }}</Button>

      <template v-if="installed && hasService">
        <Button
          v-if="isRunning"
          variant="subtle"
          size="sm"
          :disabled="busy"
          @click="emit('control', 'restart')"
        >
          <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">restart_alt</span>
          {{ t('dashboard.restartButton') }}
        </Button>
        <Button
          v-if="isRunning"
          variant="subtle"
          size="sm"
          :disabled="busy"
          @click="emit('control', 'stop')"
        >
          <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">stop</span>
          {{ t('dashboard.stopButton') }}
        </Button>
        <Button
          v-else
          variant="subtle"
          size="sm"
          :disabled="busy"
          @click="emit('control', 'start')"
        >
          <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">play_arrow</span>
          {{ t('dashboard.startButton') }}
        </Button>
      </template>

      <slot name="actions" />

      <Menu v-if="hasMenu" as="div" class="relative ml-auto">
        <MenuButton
          class="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-main hover:bg-inset transition-colors"
          :aria-label="t('dashboard.moreActions', { name })"
          :disabled="busy"
        >
          <span class="material-symbols-outlined text-[1.2rem]" aria-hidden="true">more_horiz</span>
        </MenuButton>
        <transition
          enter-active-class="transition duration-100 ease-out"
          enter-from-class="opacity-0 scale-95"
          leave-active-class="transition duration-75 ease-in"
          leave-to-class="opacity-0 scale-95"
        >
          <MenuItems
            class="absolute right-0 bottom-full mb-1 w-52 origin-bottom-right rounded-xl border border-line bg-brand-surface p-1 shadow-xl z-20 focus:outline-none"
          >
            <MenuItem v-if="canReinstall" v-slot="{ active }">
              <button
                type="button"
                :class="[
                  active ? 'bg-inset' : '',
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main',
                ]"
                @click="emit('reinstall')"
              >
                <span
                  class="material-symbols-outlined text-[1.1rem] text-text-muted"
                  aria-hidden="true"
                  >refresh</span
                >
                {{ t('dashboard.cleanReinstallLabel') }}
              </button>
            </MenuItem>
            <MenuItem v-if="canUninstall" v-slot="{ active }">
              <button
                type="button"
                :class="[
                  active ? 'bg-danger/10' : '',
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger',
                ]"
                @click="emit('uninstall')"
              >
                <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true"
                  >delete</span
                >
                {{ t('dashboard.uninstallLabel') }}
              </button>
            </MenuItem>
          </MenuItems>
        </transition>
      </Menu>
    </div>
  </div>
</template>
