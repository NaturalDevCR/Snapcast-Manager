<script setup lang="ts">
// Task 44: extracted from ServerConfig.vue -- the eighth slice of
// decomposing that view (see .superpowers/sdd/task-44-brief.md). This is
// the largest single extraction of the whole decomposition effort: the
// entire "Standard" tab (section-switcher bar + Audio Sources sub-section +
// the generic property-editor loop used by every other section).
//
// Same shared-mutable-state design as Task 43's AddEditSourceDialog.vue --
// read that component's header comment for the full empirical
// justification. Short version: props are typed as plain objects
// (`Record<string, any>` / arrays), NOT `Ref<...>`, because a real
// `<script setup>` parent's template (`:localParsedConfig="localParsedConfig"`
// in ServerConfig.vue) auto-unwraps top-level refs before handing them down
// as props -- a `Ref<...>`-typed prop would receive `undefined` for
// `.value` at runtime. This component mutates `props.localParsedConfig`/
// `props.enabledProperties` in place (nested mutation shares the same
// object instance the parent holds; full reassignment in the parent's
// `fetchBoth()` still propagates via ordinary Vue prop reactivity on
// re-render). ESLint's `vue/no-mutating-props` is disabled in narrowly
// scoped blocks around the actual mutating lines, exactly like Task 43.
import { computed, ref } from 'vue';
import { useUIStore } from '../../stores/ui';
import Card from '../Card.vue';
import PromptDialog from '../PromptDialog.vue';
import EmptyState from '../ui/EmptyState.vue';
import AddEditSourceDialog from './AddEditSourceDialog.vue';

const props = defineProps<{
  localParsedConfig: Record<string, any>;
  enabledProperties: Record<string, Record<string, boolean>>;
  configMetadata: Record<string, any>;
  configSections: Record<string, any>;
  sourceTemplates: any[];
}>();

// Task 44: the "Reset Configuration to Default" trigger lives inside this
// tab's "Bottom Actions" row, but the ConfirmDialog it opens (and the
// handler that actually performs the reset) is a page-level concern shared
// with the rest of ServerConfig.vue (it's grouped with "Restart Snapserver?"
// among the parent's own dialogs) -- out of scope for this extraction per
// the brief ("move ONLY the Add Custom Property PromptDialog, not the
// others"). This is the one piece of coupling this task's brief didn't
// anticipate: the trigger button had to move (it's part of the Standard
// tab's template) but the dialog+handler couldn't, so an emit is needed to
// signal the parent, mirroring Task 38's `restored` emit.
const emit = defineEmits<{ 'reset-requested': [] }>();

const uiStore = useUIStore();

// Local UI state -- nothing outside the Standard tab reads or sets any of
// this, so unlike `localParsedConfig`/`enabledProperties`/etc. these are
// plain local refs, not props.
const activeSection = ref('server');
const showPromptAddProperty = ref(false);
const activePromptSection = ref('');

// Task 43's dialog, now opened from within this tab instead of from
// ServerConfig.vue directly.
const addEditSourceDialog = ref<InstanceType<typeof AddEditSourceDialog> | null>(null);

const sectionIcons: Record<string, string> = {
  server: 'router',
  ssl: 'lock',
  http: 'language',
  'tcp-control': 'terminal',
  'tcp-streaming': 'sensors',
  stream: 'queue_music',
  streaming_client: 'cast',
  logging: 'article',
};

const sectionOrder = ['server', 'ssl', 'http', 'tcp-control', 'tcp-streaming', 'stream', 'streaming_client', 'logging'];

const orderedSections = computed(() => {
  return sectionOrder.filter(s => props.configSections[s]);
});

const currentSectionMeta = computed(() => {
  return props.configSections[activeSection.value] || { label: activeSection.value, description: '' };
});

// Extract the name= parameter from a source URI
const extractSourceName = (uri: string): string => {
  const match = uri.match(/[?&]name=([^&]+)/);
  return match ? decodeURIComponent(match[1]!) : '';
};

// Detect the source type from a URI for display
const getSourceType = (uri: string): string => {
  if (uri.startsWith('pipe://')) return 'Pipe';
  if (uri.startsWith('librespot://')) return 'Spotify';
  if (uri.startsWith('airplay://')) return 'AirPlay';
  if (uri.startsWith('process://') && uri.includes('ffmpeg')) return 'FFmpeg';
  if (uri.startsWith('process://')) return 'Process';
  if (uri.startsWith('file://')) return 'File';
  if (uri.startsWith('tcp://')) return 'TCP';
  if (uri.startsWith('alsa://')) return 'ALSA';
  if (uri.startsWith('meta://')) return 'Meta';
  if (uri.startsWith('jack://')) return 'JACK';
  return 'Source';
};

// Get all source names from the current config for the default_source dropdown
const availableSourceNames = computed((): string[] => {
  const sources = props.localParsedConfig?.stream?.source;
  if (!sources) return [];
  const list = Array.isArray(sources) ? sources : [sources];
  return list.map((s: string) => extractSourceName(s)).filter((n: string) => n);
});

// Returns all property keys for the active section: metadata keys + any extra keys from the config
const allPropertyKeys = computed(() => {
  const section = activeSection.value;
  const metaKeys = Object.keys(props.configMetadata[section] || {});
  const configKeys = Object.keys(props.localParsedConfig[section] || {});
  const combined = new Set([...metaKeys, ...configKeys]);
  return Array.from(combined);
});

const isPropertyEnabled = (section: string, key: string) => {
  return props.enabledProperties[section]?.[key] ?? false;
};

const toggleProperty = (section: string, key: string) => {
  const meta = props.configMetadata[section]?.[key];
  const currentlyEnabled = isPropertyEnabled(section, key);

  // Intentional mutations of the shared `localParsedConfig`/
  // `enabledProperties` props -- see the file header comment.
  /* eslint-disable vue/no-mutating-props */
  if (!props.enabledProperties[section]) {
    props.enabledProperties[section] = {};
  }

  if (currentlyEnabled) {
    // Disable: remove from localParsedConfig
    props.enabledProperties[section][key] = false;
    if (props.localParsedConfig[section]) {
      delete props.localParsedConfig[section][key];
    }
  } else {
    // Enable: add to localParsedConfig with default value
    props.enabledProperties[section][key] = true;
    if (!props.localParsedConfig[section]) {
      props.localParsedConfig[section] = {};
    }
    const defaultVal = meta?.default ?? '';
    props.localParsedConfig[section][key] = String(defaultVal);
  }
  /* eslint-enable vue/no-mutating-props */
};

const getPropertyValue = (section: string, key: string) => {
  return props.localParsedConfig[section]?.[key] ?? '';
};

const setPropertyValue = (section: string, key: string, value: any) => {
  // Intentional mutation of the shared `localParsedConfig` prop -- see the
  // file header comment.
  /* eslint-disable vue/no-mutating-props */
  if (!props.localParsedConfig[section]) {
    props.localParsedConfig[section] = {};
  }
  props.localParsedConfig[section][key] = value;
  /* eslint-enable vue/no-mutating-props */
};

const getMetaForKey = (section: string, key: string) => {
  return props.configMetadata[section]?.[key];
};

const triggerAddProperty = (section: string) => {
  activePromptSection.value = section;
  showPromptAddProperty.value = true;
};

const handleAddProperty = (key: string) => {
    const section = activePromptSection.value;
    if (!key || !section) return;
    // Intentional mutations of the shared `localParsedConfig`/
    // `enabledProperties` props -- see the file header comment.
    /* eslint-disable vue/no-mutating-props */
    if (!props.localParsedConfig[section]) props.localParsedConfig[section] = {};
    if (props.localParsedConfig[section][key] !== undefined) {
        uiStore.showToast('Property already exists', 'warning');
        return;
    }
    props.localParsedConfig[section][key] = '';
    if (!props.enabledProperties[section]) props.enabledProperties[section] = {};
    props.enabledProperties[section][key] = true;
    /* eslint-enable vue/no-mutating-props */
    uiStore.showToast(`Property "${key}" added to [${section}]`, 'success');
};

const removeSourceEntry = (idx: number) => {
  const sources = props.localParsedConfig.stream?.source;
  if (Array.isArray(sources)) {
    // Intentional mutation of the shared `localParsedConfig` prop -- see
    // the file header comment.
    /* eslint-disable vue/no-mutating-props */
    sources.splice(idx, 1);
    if (sources.length === 1) {
      props.localParsedConfig.stream.source = sources[0];
    }
    /* eslint-enable vue/no-mutating-props */
  }
};

// Task 44: the original ServerConfig.vue template used `v-model` directly
// on `localParsedConfig.stream.source[idx]` -- fine when
// `localParsedConfig` was a local ref, but `vue/no-mutating-props` (rightly)
// flags a `v-model` binding straight onto a nested prop path in the
// template, since there's no way to scope an eslint-disable comment around
// a template expression the same way the script-side mutations above are
// scoped. Same behavior, expressed as an explicit :value/@input pair like
// the sibling non-array input just below it already does via
// `setPropertyValue`, with the actual mutation isolated (and
// eslint-disabled) here in the script.
const updateSourceAtIndex = (idx: number, value: string) => {
  const sources = props.localParsedConfig.stream?.source;
  if (Array.isArray(sources)) {
    // Intentional mutation of the shared `localParsedConfig` prop -- see
    // the file header comment.
    /* eslint-disable vue/no-mutating-props */
    sources[idx] = value;
    /* eslint-enable vue/no-mutating-props */
  }
};
</script>

<template>
  <!-- Section Sub-Tabs -->
  <div class="relative border-b border-white/10 flex overflow-x-auto flex-nowrap no-scrollbar">
      <button
        v-for="sKey in orderedSections"
        :key="sKey"
        @click="activeSection = sKey"
        :class="[
            'relative flex items-center gap-2 px-4 py-3 text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all duration-200 flex-shrink-0',
            activeSection === sKey ? 'text-brand-primary' : 'text-text-muted hover:text-gray-300'
        ]"
      >
          <span
            class="material-symbols-outlined text-[15px] transition-all duration-200"
            :class="activeSection === sKey ? 'drop-shadow-[0_0_6px_rgba(166,13,242,0.6)]' : ''"
          >{{ sectionIcons[sKey] || 'tune' }}</span>
          <span>{{ configSections[sKey]?.label || sKey }}</span>
          <span
            :class="[
              'absolute bottom-0 left-0 right-0 h-[2px] bg-brand-primary rounded-full shadow-[0_0_8px_rgba(166,13,242,0.7)] transition-opacity duration-200',
              activeSection === sKey ? 'opacity-100' : 'opacity-0'
            ]"
          ></span>
      </button>
  </div>

  <!-- Section Content -->
  <Card class="!rounded-t-none border-t-0">
      <template #title>
          <div class="flex items-center space-x-3">
            <span class="material-symbols-outlined text-[20px] text-brand-primary drop-shadow-[0_0_8px_rgba(166,13,242,0.5)]">{{ sectionIcons[activeSection] || 'tune' }}</span>
            <div>
              <span class="text-sm font-black text-white uppercase tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">{{ currentSectionMeta.label }}</span>
              <p class="text-[10px] font-semibold text-text-muted mt-0.5">{{ currentSectionMeta.description }}</p>
            </div>
          </div>
      </template>
      <template #action>
          <div v-if="activeSection !== 'stream'" class="flex items-center space-x-2">
              <button @click="triggerAddProperty(activeSection)" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-brand-primary hover:text-white hover:bg-brand-primary border border-brand-primary/30 rounded-lg transition-all uppercase tracking-widest shadow-[inset_0_0_10px_rgba(166,13,242,0.1)] hover:shadow-[0_0_15px_rgba(166,13,242,0.5)]" title="Add custom property">
                <span class="material-symbols-outlined text-[14px] mr-1">add</span>
                Custom
              </button>
          </div>
      </template>

      <div v-if="activeSection === 'stream'">
          <!-- ==== SUB-SECTION 1: Audio Sources ==== -->
          <div class="mb-4">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center space-x-2">
                <span class="material-symbols-outlined text-[18px] text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">queue_music</span>
                <h3 class="text-[11px] font-black text-white uppercase tracking-widest">Audio Sources</h3>
                <span v-if="availableSourceNames.length" class="px-2 py-0.5 bg-[#00ff9d]/10 text-[#00ff9d] border border-[#00ff9d]/20 text-[10px] font-black rounded-full">{{ availableSourceNames.length }}</span>
              </div>
              <button @click="addEditSourceDialog?.openAdd()" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-[#00ff9d] hover:bg-[#00ff9d]/10 hover:text-white rounded-lg transition-all uppercase tracking-widest border border-[#00ff9d]/30 shadow-[inset_0_0_10px_rgba(0,255,157,0.1)] hover:shadow-[0_0_15px_rgba(0,255,157,0.3)]">
                <span class="material-symbols-outlined text-[14px] mr-1">add</span>
                Add Source
              </button>
            </div>

            <div v-if="!localParsedConfig.stream?.source" class="border border-dashed border-white/10 rounded-xl bg-black/20">
              <!-- No CTA here: the "Add Source" button is already visible directly
                   above this empty state in the section header (Task 33). -->
              <EmptyState
                icon="library_music"
                title="No sources configured"
                description='Use "Add Source" above to create your first audio stream.'
              />
            </div>

            <div v-else class="space-y-3">
              <div v-for="(_item, idx) in (Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source : [localParsedConfig.stream.source])" :key="idx"
                class="rounded-xl border border-white/5 bg-black/30 overflow-hidden shadow-sm hover:border-brand-primary/30 transition-colors">
                <!-- Source header with name badge -->
                <div class="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/5">
                  <div class="flex items-center space-x-2">
                    <span class="px-2 py-0.5 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-[10px] font-black uppercase tracking-widest rounded-md">
                      {{ getSourceType(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) }}
                    </span>
                    <span class="text-sm font-bold text-gray-200">
                      {{ extractSourceName(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) || 'Unnamed' }}
                    </span>
                  </div>
                  <div class="flex items-center space-x-1">
                    <button @click="addEditSourceDialog?.openEdit(idx as number)" class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center text-gray-400 hover:text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors border border-transparent hover:border-brand-primary/20" title="Edit source" :aria-label="`Edit ${extractSourceName(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) || 'source'}`">
                      <span class="material-symbols-outlined text-[16px]">edit</span>
                    </button>
                    <button v-if="Array.isArray(localParsedConfig.stream.source)" @click="removeSourceEntry(idx as number)" class="p-1.5 min-w-[40px] min-h-[40px] flex items-center justify-center text-gray-400 hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-colors border border-transparent hover:border-[#ff3b30]/20" title="Remove source" :aria-label="`Remove ${extractSourceName(Array.isArray(localParsedConfig.stream.source) ? localParsedConfig.stream.source[idx] : localParsedConfig.stream.source) || 'source'}`">
                      <span class="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
                <!-- Source URI input -->
                <div class="px-3 py-3">
                  <input
                    v-if="Array.isArray(localParsedConfig.stream.source)"
                    :value="localParsedConfig.stream.source[idx]"
                    @input="updateSourceAtIndex(idx as number, ($event.target as HTMLInputElement).value)"
                    class="w-full text-xs font-mono font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                  />
                  <input
                    v-else
                    :value="localParsedConfig.stream.source"
                    @input="setPropertyValue('stream', 'source', ($event.target as HTMLInputElement).value)"
                    class="w-full text-xs font-mono font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- ==== DIVIDER ==== -->
          <div class="border-t border-white/5 my-8"></div>

          <!-- ==== SUB-SECTION 2: Stream Settings ==== -->
          <div>
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center space-x-2">
                <span class="material-symbols-outlined text-[18px] text-[#00d4ff] drop-shadow-[0_0_5px_rgba(0,212,255,0.5)]">tune</span>
                <h3 class="text-[11px] font-black text-white uppercase tracking-widest">Stream Settings</h3>
              </div>
              <button @click="triggerAddProperty('stream')" class="inline-flex items-center px-3 py-1.5 text-[10px] font-black text-[#00d4ff] hover:text-white hover:bg-[#00d4ff]/10 border border-[#00d4ff]/30 rounded-lg transition-all uppercase tracking-widest shadow-[inset_0_0_10px_rgba(0,212,255,0.1)] hover:shadow-[0_0_15px_rgba(0,212,255,0.3)]" title="Add custom property">
                <span class="material-symbols-outlined text-[14px] mr-1">add</span>
                Custom
              </button>
            </div>

            <div class="space-y-1">
              <div v-for="key in allPropertyKeys.filter(k => k !== 'source')" :key="key"
                :class="[
                  'grid grid-cols-1 md:grid-cols-12 gap-3 items-start py-3 px-4 rounded-xl transition-all -mx-4',
                  isPropertyEnabled('stream', key)
                    ? 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                    : 'opacity-40 hover:opacity-60'
                ]">
                <!-- Enable/Disable Toggle -->
                <div class="md:col-span-1 flex items-center pt-1">
                  <button
                    @click="toggleProperty('stream', key)"
                    :class="[
                      'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                      isPropertyEnabled('stream', key) ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                    ]"
                    :title="isPropertyEnabled('stream', key) ? 'Disable this property' : 'Enable this property'"
                    :aria-label="`${isPropertyEnabled('stream', key) ? 'Disable' : 'Enable'} ${getMetaForKey('stream', key)?.label || key}`"
                  >
                    <span :class="[isPropertyEnabled('stream', key) ? 'translate-x-4' : 'translate-x-0', 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                  </button>
                </div>
                <!-- Label Column -->
                <div class="md:col-span-3">
                  <div class="flex flex-col min-w-0">
                    <label class="text-[11px] font-black text-slate-300 uppercase tracking-wide">
                      {{ getMetaForKey('stream', key)?.label || key }}
                    </label>
                    <span v-if="getMetaForKey('stream', key)?.description"
                      class="text-[10px] text-slate-400 leading-snug mt-0.5">
                      {{ getMetaForKey('stream', key)?.description }}
                    </span>
                    <span v-if="getMetaForKey('stream', key)?.default !== undefined"
                      class="text-[9px] text-indigo-400/70 dark:text-indigo-500/70 mt-0.5 font-mono">
                      default: {{ getMetaForKey('stream', key)?.default }}
                    </span>
                  </div>
                </div>
                <!-- Input Column -->
                <div class="md:col-span-8">
                  <!-- DEFAULT_SOURCE: Select dropdown from available source names -->
                  <div v-if="key === 'default_source' && isPropertyEnabled('stream', key)" class="relative">
                    <select
                      :value="getPropertyValue('stream', key)"
                      @change="setPropertyValue('stream', key, ($event.target as HTMLSelectElement).value)"
                      class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                    >
                      <option value="">(auto — first non-meta source)</option>
                      <option v-for="sName in availableSourceNames" :key="sName" :value="sName">
                        {{ sName }}
                      </option>
                    </select>
                    <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>

                  <!-- DISABLED property: show default as read-only -->
                  <div v-else-if="!isPropertyEnabled('stream', key)" class="py-1">
                    <span class="text-xs text-slate-400 font-mono">
                      {{ getMetaForKey('stream', key)?.default ?? '(empty)' }}
                    </span>
                  </div>

                  <!-- Boolean Toggle -->
                  <div v-else-if="getMetaForKey('stream', key)?.type === 'boolean'" class="flex items-center py-1">
                    <button
                      @click="setPropertyValue('stream', key, String(getPropertyValue('stream', key)) === 'true' ? 'false' : 'true')"
                      :class="[
                        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:ring-offset-2 dark:focus:ring-offset-slate-900',
                        String(getPropertyValue('stream', key)) === 'true' ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                      ]"
                      :aria-label="`${String(getPropertyValue('stream', key)) === 'true' ? 'Disable' : 'Enable'} ${getMetaForKey('stream', key)?.label || key}`"
                    >
                      <span :class="[String(getPropertyValue('stream', key)) === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                    </button>
                    <span class="ml-3 text-xs text-slate-400 font-bold uppercase tracking-widest">
                      {{ String(getPropertyValue('stream', key)) === 'true' ? 'Enabled' : 'Disabled' }}
                    </span>
                  </div>

                  <!-- Select Dropdown -->
                  <div v-else-if="getMetaForKey('stream', key)?.type === 'select'" class="relative">
                    <select
                      :value="getPropertyValue('stream', key)"
                      @change="setPropertyValue('stream', key, ($event.target as HTMLSelectElement).value)"
                      class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white appearance-none pr-10"
                    >
                      <option v-for="opt in getMetaForKey('stream', key)?.options" :key="opt" :value="opt">
                        {{ opt || '(auto)' }}
                      </option>
                    </select>
                    <ChevronDownIcon class="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>

                  <!-- Number Input -->
                  <input
                    v-else-if="getMetaForKey('stream', key)?.type === 'number'"
                    type="number"
                    :value="getPropertyValue('stream', key)"
                    @input="setPropertyValue('stream', key, ($event.target as HTMLInputElement).value)"
                    :placeholder="String(getMetaForKey('stream', key)?.default ?? '')"
                    class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                  />

                  <!-- Default Text Input -->
                  <input
                    v-else
                    :value="getPropertyValue('stream', key)"
                    @input="setPropertyValue('stream', key, ($event.target as HTMLInputElement).value)"
                    :placeholder="String(getMetaForKey('stream', key)?.default ?? '')"
                    class="w-full text-sm font-medium px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>
      </div>

      <!-- ==== NON-STREAM SECTIONS: Standard property loop ==== -->
      <div v-else class="space-y-1">
          <div v-if="allPropertyKeys.length === 0" class="text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/20">
              <p class="text-xs font-black text-text-muted uppercase tracking-widest">No properties available for this section</p>
          </div>

          <div v-for="key in allPropertyKeys" :key="key"
            :class="[
              'grid grid-cols-1 md:grid-cols-12 gap-3 items-start py-3 px-4 rounded-xl transition-all -mx-4',
              isPropertyEnabled(activeSection, key)
                ? 'hover:bg-white/5'
                : 'opacity-40 hover:opacity-60'
            ]">

              <!-- Enable/Disable Toggle (col 1) -->
              <div class="md:col-span-1 flex items-center pt-1">
                <button
                  @click="toggleProperty(activeSection, key)"
                  :class="[
                    'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
                    isPropertyEnabled(activeSection, key) ? 'bg-brand-primary' : 'bg-gray-700'
                  ]"
                  :title="isPropertyEnabled(activeSection, key) ? 'Disable this property' : 'Enable this property'"
                  :aria-label="`${isPropertyEnabled(activeSection, key) ? 'Disable' : 'Enable'} ${getMetaForKey(activeSection, key)?.label || key}`"
                >
                  <span :class="[isPropertyEnabled(activeSection, key) ? 'translate-x-4' : 'translate-x-0', 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                </button>
              </div>

              <!-- Label Column (col 2-4) -->
              <div class="md:col-span-3">
                  <div class="flex flex-col min-w-0">
                    <label class="text-[11px] font-black text-gray-300 uppercase tracking-wide">
                      {{ getMetaForKey(activeSection, key)?.label || key }}
                    </label>
                    <span v-if="getMetaForKey(activeSection, key)?.description"
                      class="text-[10px] text-text-muted leading-snug mt-0.5">
                      {{ getMetaForKey(activeSection, key)?.description }}
                    </span>
                    <span v-if="getMetaForKey(activeSection, key)?.default !== undefined"
                      class="text-[9px] text-[#00d4ff]/70 mt-0.5 font-mono">
                      default: {{ getMetaForKey(activeSection, key)?.default }}
                    </span>
                  </div>
              </div>

              <!-- Input Column (col 5-12) -->
              <div class="md:col-span-8">
                  <!-- DISABLED property: show default as read-only -->
                  <div v-if="!isPropertyEnabled(activeSection, key)" class="py-1">
                    <span class="text-xs text-text-muted font-mono">
                      {{ getMetaForKey(activeSection, key)?.default ?? '(empty)' }}
                    </span>
                  </div>

                  <!-- Boolean Toggle -->
                  <div v-else-if="getMetaForKey(activeSection, key)?.type === 'boolean'" class="flex items-center py-1">
                    <button
                      @click="setPropertyValue(activeSection, key, String(getPropertyValue(activeSection, key)) === 'true' ? 'false' : 'true')"
                      :class="[
                        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-black',
                        String(getPropertyValue(activeSection, key)) === 'true' ? 'bg-brand-primary' : 'bg-gray-700'
                      ]"
                      :aria-label="`${String(getPropertyValue(activeSection, key)) === 'true' ? 'Disable' : 'Enable'} ${getMetaForKey(activeSection, key)?.label || key}`"
                    >
                      <span :class="[String(getPropertyValue(activeSection, key)) === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out']" />
                    </button>
                    <span class="ml-3 text-xs text-gray-400 font-bold uppercase tracking-widest">
                      {{ String(getPropertyValue(activeSection, key)) === 'true' ? 'Enabled' : 'Disabled' }}
                    </span>
                  </div>

                  <!-- Select Dropdown -->
                  <div v-else-if="getMetaForKey(activeSection, key)?.type === 'select'" class="relative">
                    <select
                      :value="getPropertyValue(activeSection, key)"
                      @change="setPropertyValue(activeSection, key, ($event.target as HTMLSelectElement).value)"
                      class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 appearance-none pr-10"
                    >
                      <option v-for="opt in getMetaForKey(activeSection, key)?.options" :key="opt" :value="opt" class="bg-black text-white">
                        {{ opt || '(auto)' }}
                      </option>
                    </select>
                    <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none text-[18px]">expand_more</span>
                  </div>

                  <!-- Number Input -->
                  <input
                    v-else-if="getMetaForKey(activeSection, key)?.type === 'number'"
                    type="number"
                    :value="getPropertyValue(activeSection, key)"
                    @input="setPropertyValue(activeSection, key, ($event.target as HTMLInputElement).value)"
                    :placeholder="String(getMetaForKey(activeSection, key)?.default ?? '')"
                    class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 placeholder-gray-600"
                  />

                  <!-- Default Text Input -->
                  <input
                    v-else
                    :value="getPropertyValue(activeSection, key)"
                    @input="setPropertyValue(activeSection, key, ($event.target as HTMLInputElement).value)"
                    :placeholder="String(getMetaForKey(activeSection, key)?.default ?? '')"
                    class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 placeholder-gray-600"
                  />
              </div>
          </div>
      </div>
  </Card>

  <!-- Bottom Actions -->
  <div class="mt-8 mb-24 flex justify-center">
      <button @click="emit('reset-requested')" class="py-3 px-6 border border-white/5 rounded-xl text-text-muted hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 hover:border-[#ff3b30]/20 transition-all flex items-center space-x-2">
          <span class="material-symbols-outlined text-[16px]">restart_alt</span>
          <span class="text-[10px] font-black uppercase tracking-widest">Reset Configuration to Default</span>
      </button>
  </div>

  <!-- ==================== ADD SOURCE DIALOG ==================== -->
  <!-- Task 43: components/server-config/AddEditSourceDialog.vue; used from
       within this tab since Task 44 (previously wired directly into
       ServerConfig.vue). -->
  <AddEditSourceDialog
    ref="addEditSourceDialog"
    :localParsedConfig="localParsedConfig"
    :enabledProperties="enabledProperties"
    :sourceTemplates="sourceTemplates"
  />

  <PromptDialog
    v-model="showPromptAddProperty"
    title="Add Custom Property"
    :message="`Enter a custom property name for [${activePromptSection}]:`"
    placeholder="e.g. custom_key"
    @confirm="handleAddProperty"
  />
</template>
