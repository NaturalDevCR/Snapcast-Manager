<script setup lang="ts">
// Onboarding.vue -- Task 49 (docs/superpowers/plans/2026-08-25-onboarding-wizard.md,
// Task 3). Renders the post-setup onboarding wizard's steps 1 and 2:
//   1. Install snapserver (uses the existing systemStore).
//   2. Add a first pipe source (embeds AddEditPipeDialog.vue from Task 42,
//      auto-opened, advancing to step 3 on its `saved` emit).
//
// Step 3's body below is DELIBERATELY a static placeholder for this task --
// Task 4 (Task 50) replaces it with a live, SSE-driven "waiting for a
// client" state and the real per-zone assignment control. This is an
// explicit, plan-specified interim state (see plan Task 3's Interfaces
// note), not a "no placeholders" violation -- kept as a clean drop-in swap
// target for that follow-up task.
import { ref, computed, onMounted, watch } from 'vue';
import Layout from '../components/Layout.vue';
import Button from '../components/ui/Button.vue';
import AddEditPipeDialog from '../components/pipe-sources/AddEditPipeDialog.vue';
import { useOnboardingStore } from '../stores/onboarding';
import { useSystemStore } from '../stores/system';
import { usePipeSourcesStore } from '../stores/pipeSources';
import { useRouter } from 'vue-router';

const onboardingStore = useOnboardingStore();
const systemStore = useSystemStore();
const pipeSourcesStore = usePipeSourcesStore();
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

async function handleInstallSnapserver() {
  await systemStore.installPackage('snapserver');
}

async function advanceTo(step: number) {
  await onboardingStore.setStep(step);
}

async function handlePipeSaved() {
  await advanceTo(3);
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
        <h1 class="text-2xl font-black text-text-main">Get Started</h1>
        <button @click="skip" class="text-xs font-bold text-text-muted hover:text-text-main uppercase tracking-widest">
          Skip for now
        </button>
      </div>

      <div class="flex items-center gap-2" aria-label="Onboarding progress">
        <div v-for="n in 3" :key="n" class="flex-1 h-1 rounded-full"
             :class="onboardingStore.step >= n ? 'bg-brand-primary' : 'bg-white/10'"></div>
      </div>

      <div v-if="onboardingStore.step === 1" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">1. Set Up Snapserver</h2>
        <p class="text-sm text-text-muted">Snapserver is the audio server this app manages.</p>
        <div v-if="!step1Done">
          <Button :loading="systemStore.loading" @click="handleInstallSnapserver">Install Snapserver</Button>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-[#00ff9d]">Snapserver is installed.</p>
          <Button @click="advanceTo(2)">Next</Button>
        </div>
      </div>

      <div v-else-if="onboardingStore.step === 2" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">2. Add your first source</h2>
        <p v-if="step2Done" class="text-sm text-text-muted">
          You already have {{ pipeSourcesStore.pipes.length }} source(s) configured.
        </p>
        <Button v-if="step2Done" @click="advanceTo(3)">Next</Button>
        <AddEditPipeDialog ref="addEditDialog" @saved="handlePipeSaved" />
      </div>

      <div v-else-if="onboardingStore.step === 3" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">3. Assign your first zone</h2>
        <!-- Task 4 (Task 50) replaces this static body with a live, SSE-driven
             "waiting for a client" state and the real per-zone <Select>
             assignment control. -->
        <p class="text-sm text-text-muted">
          Connect a client (a physical snapclient device on your network, or
          this app's own local Client mode), then come back here to assign it
          a source.
        </p>
      </div>
    </div>
  </Layout>
</template>
