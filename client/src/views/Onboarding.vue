<script setup lang="ts">
// Onboarding.vue -- Tasks 49-50 (docs/superpowers/plans/2026-08-25-onboarding-wizard.md,
// Tasks 3-4). Renders the post-setup onboarding wizard's 3 steps:
//   1. Install snapserver (uses the existing systemStore).
//   2. Add a first pipe source (embeds AddEditPipeDialog.vue from Task 42,
//      auto-opened, advancing to step 3 on its `saved` emit).
//   3. Assign the first zone (reads snapcastStore.status, already
//      SSE-driven app-wide -- no new polling/watcher; shows a live
//      "waiting for a client" state until a group has one, then the same
//      accessible per-zone <Select> pattern Task 34 built in Routing.vue,
//      calling snapcastStore.setGroupStream()). Marks onboarding complete
//      and redirects to `/` on assignment.
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Layout from '../components/Layout.vue';
import Button from '../components/ui/Button.vue';
import Select from '../components/ui/Select.vue';
import AddEditPipeDialog from '../components/pipe-sources/AddEditPipeDialog.vue';
import { useOnboardingStore } from '../stores/onboarding';
import { useSystemStore } from '../stores/system';
import { usePipeSourcesStore } from '../stores/pipeSources';
import { useSnapcastStore } from '../stores/snapcast';
import { useRouter } from 'vue-router';

const { t } = useI18n({ useScope: 'global' });
const onboardingStore = useOnboardingStore();
const systemStore = useSystemStore();
const pipeSourcesStore = usePipeSourcesStore();
const snapcastStore = useSnapcastStore();
const router = useRouter();

const addEditDialog = ref<InstanceType<typeof AddEditPipeDialog> | null>(null);

onMounted(async () => {
  await onboardingStore.fetchOnboarding();
  if (pipeSourcesStore.pipes.length === 0) {
    await pipeSourcesStore.fetchPipes();
  }
  if (onboardingStore.step === 2 && pipeSourcesStore.pipes.length === 0) {
    addEditDialog.value?.openAdd();
  }
});

// Re-open the dialog if step becomes 2 after mount (e.g. advancing from step
// 1). `flush: 'post'` matters here: AddEditPipeDialog is only rendered
// inside the `step === 2` template branch, so the `addEditDialog` template
// ref isn't populated until Vue has re-rendered for the new step -- a
// default (pre-flush) watcher callback would run before that DOM update and
// find `addEditDialog.value` still null.
watch(() => onboardingStore.step, (step) => {
  if (step === 2 && pipeSourcesStore.pipes.length === 0) {
    addEditDialog.value?.openAdd();
  }
}, { flush: 'post' });

const step1Done = computed(() => systemStore.installedPackages.snapserver);
const step2Done = computed(() => pipeSourcesStore.pipes.length > 0);

// Step 3: reads snapcastStore.status directly (a Pinia ref reassigned
// wholesale by useEventSource.ts's applySnapcastUpdate() on every SSE
// `snapcast` event -- see composables/useEventSource.ts) rather than
// polling or watching anything new here. Because this is a plain computed
// over that ref, it re-evaluates automatically on every SSE push, which is
// what gives step 3 its "waiting for a client" state a live update the
// moment one connects, with no extra watcher/poller needed.
const firstGroupWithClient = computed(() =>
  snapcastStore.status?.groups.find((g) => g.clients.length > 0) ?? null
);

// Named interpolation for step 3's dynamic zone name (t('onboarding.
// zoneFallbackName', { id }) rather than string concatenation) -- see
// task-55-brief.md's CRITICAL note.
const zoneDisplayName = computed(() => {
  const group = firstGroupWithClient.value;
  if (!group) return '';
  return group.name || t('onboarding.zoneFallbackName', { id: group.id.slice(0, 4) });
});

const streamSelectOptions = computed(() =>
  (snapcastStore.status?.streams || []).map((stream: any) => ({
    value: stream.id,
    label: stream.uri?.query?.name || stream.id,
  }))
);

async function handleInstallSnapserver() {
  await systemStore.installPackage('snapserver');
}

async function advanceTo(step: number) {
  await onboardingStore.setStep(step);
}

async function handlePipeSaved() {
  await advanceTo(3);
}

async function handleZoneAssignment(streamId: string | number) {
  const group = firstGroupWithClient.value;
  if (!group) return;
  await snapcastStore.setGroupStream(group.id, String(streamId));
  await advanceTo(3);
  router.push('/');
}

async function skip() {
  await onboardingStore.dismiss();
  router.push('/');
}
</script>

<template>
  <Layout>
    <div class="max-w-2xl mx-auto py-12 space-y-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-black text-text-main">{{ t('onboarding.getStarted') }}</h1>
        <button @click="skip" class="text-xs font-bold text-text-muted hover:text-text-main uppercase tracking-widest">
          {{ t('onboarding.skip') }}
        </button>
      </div>

      <div class="flex items-center gap-2" :aria-label="t('onboarding.progressLabel')">
        <div v-for="n in 3" :key="n" class="flex-1 h-1 rounded-full"
             :class="onboardingStore.step >= n ? 'bg-brand-primary' : 'bg-black/10 dark:bg-white/10'"></div>
      </div>

      <div v-if="onboardingStore.step === 1" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">{{ t('onboarding.step1Title') }}</h2>
        <p class="text-sm text-text-muted">{{ t('onboarding.step1Description') }}</p>
        <div v-if="!step1Done">
          <Button :loading="systemStore.loading" @click="handleInstallSnapserver">{{ t('onboarding.installSnapserver') }}</Button>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-[#00ff9d]">{{ t('onboarding.step1Complete') }}</p>
          <Button @click="advanceTo(2)">{{ t('onboarding.next') }}</Button>
        </div>
      </div>

      <div v-else-if="onboardingStore.step === 2" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">{{ t('onboarding.step2Title') }}</h2>
        <p v-if="step2Done" class="text-sm text-text-muted">
          {{ t('onboarding.step2AlreadyHave', { count: pipeSourcesStore.pipes.length }) }}
        </p>
        <Button v-if="step2Done" @click="advanceTo(3)">{{ t('onboarding.next') }}</Button>
        <AddEditPipeDialog ref="addEditDialog" @saved="handlePipeSaved" />
      </div>

      <div v-else-if="onboardingStore.step === 3" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">{{ t('onboarding.step3Title') }}</h2>
        <div v-if="!firstGroupWithClient" class="space-y-2">
          <p class="text-sm text-text-muted">
            {{ t('onboarding.step3Waiting') }}
          </p>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-text-muted">
            {{ t('onboarding.step3ZoneReady', { zoneName: zoneDisplayName }) }}
          </p>
          <Select
            :model-value="firstGroupWithClient.stream_id"
            :options="streamSelectOptions"
            :placeholder="t('onboarding.chooseSourcePlaceholder')"
            @update:model-value="handleZoneAssignment"
          />
        </div>
      </div>
    </div>
  </Layout>
</template>
