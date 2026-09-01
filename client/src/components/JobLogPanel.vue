<script setup lang="ts">
// Feature request found live: a user installing/updating a package (e.g.
// shairport-sync, whose real install takes several minutes compiling from
// source) only ever saw ONE line at a time -- Dashboard.vue's old loading
// overlay showed `systemStore.loadingMessage`, which is just the job's
// latest log line, overwritten every 2s poll. This panel shows the job's
// FULL, growing log (systemStore.jobLog, populated by the same poll --
// see stores/system.ts's runJob()) in a real, scrollable, terminal-styled
// window instead, auto-scrolling to the newest line as it arrives.
//
// Deliberately its own component (not inlined into Dashboard.vue's old
// overlay) so ClientDashboard.vue's identical install/update flow
// (installPackage('snapclient'), same systemStore) can reuse it without
// duplicating the log-rendering/auto-scroll logic.
import { ref, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSystemStore } from '../stores/system';

const { t } = useI18n({ useScope: 'global' });
const systemStore = useSystemStore();

const logContainer = ref<HTMLElement | null>(null);

// Auto-scroll to the newest line whenever the log grows -- a real install
// log a user asked to actually watch is only useful if it keeps the
// latest output in view without them having to manually scroll on every
// new line.
watch(
  () => systemStore.jobLog.length,
  async () => {
    await nextTick();
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight;
    }
  }
);
</script>

<template>
  <div
    v-if="systemStore.loading"
    class="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg/40 backdrop-blur-sm p-4"
  >
    <div
      class="bg-brand-surface/95 rounded-2xl shadow-2xl border border-brand-primary/20 backdrop-blur-xl w-full max-w-2xl animate-in fade-in zoom-in duration-300 overflow-hidden"
    >
      <div class="flex items-center gap-3 px-5 py-4 border-b border-black/5 dark:border-white/5">
        <span class="material-symbols-outlined animate-spin text-brand-primary text-2xl shrink-0">sync</span>
        <span class="text-sm font-bold text-text-main tracking-widest uppercase truncate">
          {{ systemStore.loadingMessage || t('dashboard.loadingFallback') }}
        </span>
      </div>

      <!-- Only shown once the job has produced at least one log line --
           quick, synchronous actions (start/stop/restart a service) go
           through the exact same `loading`/`loadingMessage` state but
           never populate jobLog (see runJob() -- only real background
           jobs with a jobId do), so this stays out of their way entirely
           rather than showing an empty terminal panel for a one-second
           action. -->
      <div
        v-if="systemStore.jobLog.length > 0"
        ref="logContainer"
        class="bg-black/90 text-emerald-400 font-mono text-xs leading-relaxed p-4 max-h-80 overflow-y-auto"
      >
        <div v-for="(line, i) in systemStore.jobLog" :key="i" class="whitespace-pre-wrap break-all">{{ line }}</div>
      </div>
    </div>
  </div>
</template>
