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
import JobLogPanel from '../components/JobLogPanel.vue';
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

// A brand-new admin account starts at onboarding_step 0 (server/src/
// auth.ts), but the template only had branches for steps 1-3 -- so the
// wizard rendered a title and an empty progress bar and nothing else. Step
// 0 ("not started") is shown as step 1.
const currentStep = computed(() => Math.min(3, Math.max(1, onboardingStore.step)));

const addEditDialog = ref<InstanceType<typeof AddEditPipeDialog> | null>(null);

onMounted(async () => {
  await onboardingStore.fetchOnboarding();
  // Step 1's "installed?" check reads installedPackages, which nothing on
  // this view used to populate -- on a direct visit it always claimed
  // snapserver was missing.
  systemStore.checkInstalled('snapserver');
  if (pipeSourcesStore.pipes.length === 0) {
    await pipeSourcesStore.fetchPipes();
  }
  if (currentStep.value === 2 && pipeSourcesStore.pipes.length === 0) {
    addEditDialog.value?.openAdd();
  }
});

// Re-open the dialog if step becomes 2 after mount (e.g. advancing from step
// 1). `flush: 'post'` matters here: AddEditPipeDialog is only rendered
// inside the `step === 2` template branch, so the `addEditDialog` template
// ref isn't populated until Vue has re-rendered for the new step -- a
// default (pre-flush) watcher callback would run before that DOM update and
// find `addEditDialog.value` still null.
watch(currentStep, (step) => {
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
    <JobLogPanel />
    <div class="max-w-2xl mx-auto sm:py-6 space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-text-main">{{ t('onboarding.getStarted') }}</h1>
        <button @click="skip" class="text-sm font-medium text-text-muted hover:text-text-main">
          {{ t('onboarding.skip') }}
        </button>
      </div>

      <!-- Stepper (was three unlabeled bars) -->
      <ol class="grid grid-cols-3 gap-2" :aria-label="t('onboarding.progressLabel')">
        <li v-for="n in 3" :key="n" class="flex flex-col gap-2" :aria-current="currentStep === n ? 'step' : undefined">
          <span class="h-1 rounded-full" :class="currentStep >= n ? 'bg-brand-primary' : 'bg-line'"></span>
          <span class="flex items-center gap-1.5 text-xs font-medium" :class="currentStep === n ? 'text-text-main' : 'text-text-muted'">
            <span
              class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold flex-shrink-0"
              :class="currentStep > n ? 'bg-success/15 text-success' : currentStep === n ? 'bg-brand-primary text-white' : 'bg-inset text-text-muted border border-line'"
            >
              <span v-if="currentStep > n" class="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
              <template v-else>{{ n }}</template>
            </span>
            <span class="truncate">{{ t(`onboarding.stepShort${n}`) }}</span>
          </span>
        </li>
      </ol>

      <section class="rounded-2xl border border-line bg-brand-surface/80 p-5 sm:p-6 shadow-sm space-y-4">
        <template v-if="currentStep === 1">
          <h2 class="text-lg font-bold text-text-main">{{ t('onboarding.step1Title') }}</h2>
          <p class="text-sm text-text-muted">{{ t('onboarding.step1Description') }}</p>
          <div v-if="!step1Done">
            <Button :loading="systemStore.loading" @click="handleInstallSnapserver">{{ t('onboarding.installSnapserver') }}</Button>
          </div>
          <div v-else class="space-y-4">
            <p class="flex items-center gap-2 text-sm text-success">
              <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">check_circle</span>
              {{ t('onboarding.step1Complete') }}
            </p>
            <Button @click="advanceTo(2)">{{ t('onboarding.next') }}</Button>
          </div>
        </template>

        <template v-else-if="currentStep === 2">
          <h2 class="text-lg font-bold text-text-main">{{ t('onboarding.step2Title') }}</h2>
          <template v-if="step2Done">
            <p class="text-sm text-text-muted">
              {{ t('onboarding.step2AlreadyHave', { count: pipeSourcesStore.pipes.length }) }}
            </p>
            <Button @click="advanceTo(3)">{{ t('onboarding.next') }}</Button>
          </template>
          <!-- Closing the dialog used to leave this step with no way to
               reopen it. -->
          <template v-else>
            <p class="text-sm text-text-muted">{{ t('onboarding.step2Description') }}</p>
            <Button @click="addEditDialog?.openAdd()">
              <span class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">add</span>
              {{ t('onboarding.addSourceButton') }}
            </Button>
          </template>
          <AddEditPipeDialog ref="addEditDialog" @saved="handlePipeSaved" />
        </template>

        <template v-else-if="currentStep === 3">
          <h2 class="text-lg font-bold text-text-main">{{ t('onboarding.step3Title') }}</h2>
          <div v-if="!firstGroupWithClient" class="space-y-3">
            <p class="flex items-start gap-2.5 text-sm text-text-muted">
              <span class="relative mt-1.5 flex h-2 w-2 flex-shrink-0" aria-hidden="true">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-primary opacity-60"></span>
                <span class="relative inline-flex h-2 w-2 rounded-full bg-brand-primary"></span>
              </span>
              {{ t('onboarding.step3Waiting') }}
            </p>
            <router-link to="/client" class="inline-flex items-center gap-1 text-sm font-semibold text-brand-primary-text hover:underline">
              {{ t('onboarding.useLocalClient') }}
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">arrow_forward</span>
            </router-link>
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
        </template>
      </section>
    </div>
  </Layout>
</template>
