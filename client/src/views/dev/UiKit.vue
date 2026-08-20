<script setup lang="ts">
// UiKit.vue — dev-only visual showcase for Task 21's and Task 22's UI
// primitives.
//
// NOT linked from Layout.vue's navigation — reachable only by directly
// visiting /dev/ui-kit. Exists purely so a human (or an agent driving a
// browser) can visually confirm these primitives render correctly against
// the real token system, in both themes, rather than trusting the
// <script setup> source alone. Toggles the SAME app-wide theme mechanism
// used everywhere else (useUIStore().toggleTheme(), which flips the `dark`
// class on <html> and persists to localStorage) rather than inventing a
// separate preview-only theme switch, so what's shown here is exactly what
// production theme switching produces.
import { ref } from 'vue';
import { useUIStore } from '../../stores/ui';
import Button from '../../components/ui/Button.vue';
import Input from '../../components/ui/Input.vue';
import Select from '../../components/ui/Select.vue';
import Toggle from '../../components/ui/Toggle.vue';
import Badge from '../../components/ui/Badge.vue';
import Modal from '../../components/ui/Modal.vue';
import ConfirmDestructive from '../../components/ui/ConfirmDestructive.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import Skeleton from '../../components/ui/Skeleton.vue';
import SectionHeader from '../../components/ui/SectionHeader.vue';

const uiStore = useUIStore();

const buttonVariants = ['primary', 'secondary', 'danger', 'ghost'] as const;
const buttonSizes = ['sm', 'md', 'lg'] as const;

const badgeVariants = ['success', 'warning', 'danger', 'neutral', 'brand'] as const;
const badgeSizes = ['sm', 'md'] as const;

const textValue = ref('');
const errorValue = ref('Bad value');
const presetValue = ref('Preset text');

const selectValue = ref<string | number | null>('b');
const selectOptions = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C (a longer label)' },
];

const toggleOn = ref(true);
const toggleOff = ref(false);
const toggleDisabled = ref(true);

// Modal
const modalSm = ref(false);
const modalMd = ref(false);
const modalLg = ref(false);
const modalNoTitle = ref(false);

// ConfirmDestructive — live demo of the disabled-until-exact-match safety
// behavior. `confirmResult` is rendered in the page so a human (or a
// browser-driving agent) can visually confirm which event actually fired,
// not just trust the console.
const confirmOpen = ref(false);
const confirmResult = ref<'none' | 'confirmed' | 'cancelled'>('none');
function openConfirmDemo() {
  confirmResult.value = 'none';
  confirmOpen.value = true;
}

// EmptyState
const emptyStateActionClicks = ref(0);

// Skeleton — a fake "card" made of skeleton pieces, common real usage.
const skeletonVariants = ['text', 'circle', 'rect'] as const;
</script>

<template>
  <div class="min-h-screen bg-brand-bg text-text-main transition-colors duration-500 p-8">
    <div class="max-w-5xl mx-auto space-y-10">
      <header class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-black tracking-tight">UI Kit — Dev Showcase</h1>
          <p class="text-xs font-bold uppercase tracking-[0.2em] text-text-muted mt-1">
            Task 21 + 22 primitives · dev-only · not linked from navigation
          </p>
        </div>
        <Button variant="secondary" @click="uiStore.toggleTheme()">
          {{ uiStore.isDark ? 'Switch to light' : 'Switch to dark' }}
        </Button>
      </header>

      <!-- Button -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Button</h2>
        <div v-for="size in buttonSizes" :key="size" class="flex flex-wrap items-center gap-3">
          <span class="text-xs font-bold uppercase tracking-wider text-text-muted w-10">{{ size }}</span>
          <Button v-for="variant in buttonVariants" :key="variant" :variant="variant" :size="size">
            {{ variant }}
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-xs font-bold uppercase tracking-wider text-text-muted w-10">state</span>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button variant="danger" loading>Loading danger</Button>
        </div>
      </section>

      <!-- Input -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Input</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <Input v-model="textValue" label="Empty, with label" placeholder="Type something…" />
          <Input v-model="presetValue" label="Pre-filled" />
          <Input v-model="errorValue" label="With error" error="This field has a validation error" />
          <Input model-value="Disabled value" label="Disabled" disabled />
          <Input type="password" label="Password type" placeholder="••••••••" />
          <Input label="No model bound yet" placeholder="No label icon slot used" />
        </div>
      </section>

      <!-- Select -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Select</h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">Selected</p>
            <Select v-model="selectValue" :options="selectOptions" />
          </div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">Placeholder</p>
            <Select :options="selectOptions" placeholder="Choose an option…" />
          </div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5">Disabled</p>
            <Select :options="selectOptions" model-value="a" disabled />
          </div>
        </div>
      </section>

      <!-- Toggle -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Toggle</h2>
        <div class="flex flex-wrap gap-8">
          <Toggle v-model="toggleOn" label="On" />
          <Toggle v-model="toggleOff" label="Off" />
          <Toggle v-model="toggleDisabled" label="Disabled (on)" disabled />
        </div>
      </section>

      <!-- Badge -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Badge</h2>
        <div v-for="size in badgeSizes" :key="size" class="flex flex-wrap items-center gap-3">
          <span class="text-xs font-bold uppercase tracking-wider text-text-muted w-10">{{ size }}</span>
          <Badge v-for="variant in badgeVariants" :key="variant" :variant="variant" :size="size">
            {{ variant }}
          </Badge>
        </div>
      </section>

      <!-- SectionHeader -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-6">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">SectionHeader</h2>

        <div class="border border-brand-primary/10 rounded-2xl p-4">
          <SectionHeader title="Core System Services" />
        </div>

        <div class="border border-brand-primary/10 rounded-2xl p-4">
          <SectionHeader
            eyebrow="Live Infrastructure"
            title="Streams"
            description="Configured audio routes and their current status."
          />
        </div>

        <div class="border border-brand-primary/10 rounded-2xl p-4">
          <SectionHeader title="Pipe Sources" description="With an action on the right.">
            <template #action>
              <Button size="sm">
                <span class="material-symbols-outlined text-[1rem]">add</span>
                Add
              </Button>
            </template>
          </SectionHeader>
        </div>
      </section>

      <!-- EmptyState -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">EmptyState</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div class="border border-brand-primary/10 rounded-2xl">
            <EmptyState icon="sensors" title="No pipe sources configured" />
          </div>
          <div class="border border-brand-primary/10 rounded-2xl">
            <EmptyState
              icon="speaker_notes_off"
              title="No instances configured"
              description="Add a client instance to start routing audio to a device."
            >
              <template #action>
                <Button size="sm" @click="emptyStateActionClicks++">
                  <span class="material-symbols-outlined text-[1rem]">add</span>
                  Add your first instance
                </Button>
              </template>
            </EmptyState>
          </div>
        </div>
        <p class="text-xs text-text-muted">Action clicked: {{ emptyStateActionClicks }} time(s)</p>
      </section>

      <!-- Skeleton -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Skeleton</h2>
        <div class="flex flex-wrap items-center gap-6">
          <div v-for="variant in skeletonVariants" :key="variant" class="flex flex-col items-start gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-text-muted">{{ variant }}</span>
            <Skeleton :variant="variant" :width="variant === 'circle' ? undefined : 160" />
          </div>
          <div class="flex flex-col items-start gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-text-muted">custom size</span>
            <Skeleton variant="rect" :width="220" height="60px" />
          </div>
        </div>
        <div class="max-w-sm border border-brand-primary/10 rounded-2xl p-4 flex items-center gap-4">
          <Skeleton variant="circle" />
          <div class="flex-1 space-y-2">
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="40%" />
          </div>
        </div>
      </section>

      <!-- Modal -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">Modal</h2>
        <div class="flex flex-wrap gap-3">
          <Button size="sm" @click="modalSm = true">Open sm</Button>
          <Button size="sm" @click="modalMd = true">Open md</Button>
          <Button size="sm" @click="modalLg = true">Open lg</Button>
          <Button size="sm" variant="secondary" @click="modalNoTitle = true">Open (no title)</Button>
        </div>

        <Modal v-model="modalSm" title="Small modal" size="sm">
          <p>This is a small (sm) modal. Escape, backdrop click, and the close button all dismiss it.</p>
          <template #footer>
            <Button variant="secondary" @click="modalSm = false">Cancel</Button>
            <Button @click="modalSm = false">Confirm</Button>
          </template>
        </Modal>

        <Modal v-model="modalMd" title="Medium modal" size="md">
          <p>This is a medium (md, default) modal, with a footer using Button.vue for actions.</p>
          <template #footer>
            <Button variant="secondary" @click="modalMd = false">Cancel</Button>
            <Button @click="modalMd = false">Confirm</Button>
          </template>
        </Modal>

        <Modal v-model="modalLg" title="Large modal" size="lg">
          <p>This is a large (lg) modal — no footer slot used here, so no footer row renders.</p>
        </Modal>

        <Modal v-model="modalNoTitle">
          <p>A modal with no title — only the close button appears in the header row.</p>
        </Modal>
      </section>

      <!-- ConfirmDestructive -->
      <section class="bg-brand-surface/80 border border-brand-primary/10 rounded-[2rem] p-6 space-y-4">
        <h2 class="text-sm font-black uppercase tracking-wide text-text-main">ConfirmDestructive</h2>
        <p class="text-xs text-text-muted max-w-xl">
          Live safety-mechanism demo: click "Delete pipe source", then try typing a wrong name (the
          Delete button stays disabled) before typing the exact entity name
          <span class="font-black text-text-main">living-room-speaker</span> (the Delete button enables).
        </p>
        <div class="flex items-center gap-4">
          <Button variant="danger" size="sm" @click="openConfirmDemo">Delete pipe source…</Button>
          <span class="text-xs font-bold uppercase tracking-wider text-text-muted">
            Last result:
            <Badge
              :variant="confirmResult === 'confirmed' ? 'danger' : confirmResult === 'cancelled' ? 'neutral' : 'brand'"
            >
              {{ confirmResult }}
            </Badge>
          </span>
        </div>

        <ConfirmDestructive
          v-model="confirmOpen"
          title="Delete pipe source"
          message="This will permanently remove the pipe source and its configuration. This action cannot be undone."
          entity-name="living-room-speaker"
          confirm-label="Delete"
          @confirm="confirmResult = 'confirmed'"
          @cancel="confirmResult = 'cancelled'"
        />
      </section>
    </div>
  </div>
</template>
