<script setup lang="ts">
// UiKit.vue — dev-only visual showcase for Task 21's (and, later, Task 22's)
// UI primitives.
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
</script>

<template>
  <div class="min-h-screen bg-brand-bg text-text-main transition-colors duration-500 p-8">
    <div class="max-w-5xl mx-auto space-y-10">
      <header class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-black tracking-tight">UI Kit — Dev Showcase</h1>
          <p class="text-xs font-bold uppercase tracking-[0.2em] text-text-muted mt-1">
            Task 21 primitives · dev-only · not linked from navigation
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

      <!--
        Room for Task 22's primitives (Modal, EmptyState, Skeleton,
        SectionHeader, ConfirmDestructive) — add sections below this
        comment when that task lands.
      -->
    </div>
  </div>
</template>
