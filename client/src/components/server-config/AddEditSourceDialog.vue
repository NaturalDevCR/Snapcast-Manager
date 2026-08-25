<script setup lang="ts">
// Task 43: extracted from ServerConfig.vue -- the seventh slice of
// decomposing that view (Task 38 did the self-contained Snapshots tab;
// this is the first slice of the genuinely-coupled remainder; see
// .superpowers/sdd/task-43-brief.md).
//
// Unlike Tasks 38-42, this dialog directly mutates deeply-nested paths on
// `localParsedConfig`/`enabledProperties` -- the SAME reactive objects the
// Standard tab's generic property-editor loop reads to render the page.
// The brief's proposed design was to type these props as `Ref<...>` and
// have this component do `props.x.value...`. Empirical verification (see
// the task-43 report) showed that's WRONG for a real `<script setup>`
// parent: Vue's compiler auto-unwraps top-level refs referenced in a
// parent's template, so `:localParsedConfig="localParsedConfig"` in
// ServerConfig.vue's template actually hands this component the
// *unwrapped* reactive object, not a `Ref` wrapper -- `props.x.value`
// would be `undefined` at runtime. The plain-object props below are the
// correct realization of the brief's actual goal (share the live mutable
// state, no clone-and-diff-emit): nested mutations here (e.g.
// `props.localParsedConfig.stream.source = ...`) mutate the exact object
// instance the parent holds, and Vue's normal prop reactivity keeps this
// component's props in sync even if the parent later reassigns
// `localParsedConfig.value` wholesale (e.g. in `fetchBoth()`).
import { computed, ref } from 'vue';
import { useUIStore } from '../../stores/ui';
import EmptyState from '../ui/EmptyState.vue';

const props = defineProps<{
  localParsedConfig: Record<string, any>;
  enabledProperties: Record<string, Record<string, boolean>>;
  sourceTemplates: any[];
}>();

const uiStore = useUIStore();

// Dialog State
const showAddSourceDialog = ref(false);
const isEditingSource = ref(false);
const editingSourceIdx = ref<number | null>(null);

// Source creation state
const selectedSourceType = ref('');
const sourceFormPath = ref('');
const sourceFormParams = ref<Record<string, string>>({});
const metaSelectedSources = ref<string[]>([]);

const selectedTemplate = computed(() => {
  return props.sourceTemplates.find((t: any) => t.type === selectedSourceType.value);
});

// Extract the name= parameter from a source URI. Duplicated from
// ServerConfig.vue's copy on purpose (see the brief): it's a small, pure
// 3-line function, and a shared-utils module would be more machinery than
// this warrants.
const extractSourceName = (uri: string): string => {
  const match = uri.match(/[?&]name=([^&]+)/);
  return match ? decodeURIComponent(match[1]!) : '';
};

// Get all non-meta source names for the meta-stream picker
const availableMetaSources = computed((): string[] => {
  const sources = props.localParsedConfig?.stream?.source;
  if (!sources) return [];
  const list = Array.isArray(sources) ? sources : [sources];
  return list
    .filter((s: string) => !s.startsWith('meta://'))
    .map((s: string) => extractSourceName(s))
    .filter((n: string) => n);
});

const addMetaSource = (name: string) => {
  if (!metaSelectedSources.value.includes(name)) {
    metaSelectedSources.value.push(name);
  }
};

const removeMetaSource = (idx: number) => {
  metaSelectedSources.value.splice(idx, 1);
};

const moveMetaSource = (idx: number, direction: 'up' | 'down') => {
  const arr = metaSelectedSources.value;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= arr.length) return;
  const temp = arr[idx]!;
  arr[idx] = arr[swapIdx]!;
  arr[swapIdx] = temp;
};

const selectSourceType = (type: string) => {
  selectedSourceType.value = type;
  const template = props.sourceTemplates.find((t: any) => t.type === type);
  if (template) {
    if (!isEditingSource.value) {
      sourceFormPath.value = template.pathPlaceholder;
      sourceFormParams.value = {};
      for (const p of template.params) {
        sourceFormParams.value[p.key] = p.default || '';
      }
      if (template.isMeta) {
        metaSelectedSources.value = [];
      }
    }
  }
};

const buildSourceUri = (): string => {
  const template = selectedTemplate.value;
  if (!template) return '';

  // Meta streams build path from selected sources
  if (template.isMeta) {
    const metaPath = metaSelectedSources.value.map(s => encodeURIComponent(s)).join('/');
    let uri = `${template.uriPrefix}/${metaPath}`;
    const params: string[] = [];
    for (const p of template.params) {
      const val = sourceFormParams.value[p.key];
      if (val !== undefined && val !== '' && val !== p.default) {
        params.push(`${p.key}=${encodeURIComponent(val)}`);
      } else if (p.required && val) {
        params.push(`${p.key}=${encodeURIComponent(val)}`);
      }
    }
    if (params.length > 0) {
      uri += '?' + params.join('&');
    }
    return uri;
  }

  let path = sourceFormPath.value || template.pathPlaceholder;
  if (path.startsWith('//')) {
      path = '/' + path.replace(/^\/+/, '');
  }
  let uri = `${template.uriPrefix}${path}`;

  const params: string[] = [];

  if (template.type === 'ffmpeg_radio') {
    const streamUrl = sourceFormParams.value['_stream_url'] || '';
    const name = sourceFormParams.value['name'] || 'Radio';
    const sampleformat = sourceFormParams.value['sampleformat'] || '48000:16:2';
    const [rate, , channels] = sampleformat.split(':');

    const getBool = (key: string, def: boolean) => {
      const v = sourceFormParams.value[key];
      return v === undefined ? def : v === 'true' || (v as unknown) === true;
    };
    const reconnectFlags: string[] = [];
    if (getBool('_reconnect', true))                  reconnectFlags.push('-reconnect 1');
    if (getBool('_reconnect_streamed', true))          reconnectFlags.push('-reconnect_streamed 1');
    if (getBool('_reconnect_at_eof', false))           reconnectFlags.push('-reconnect_at_eof 1');
    if (getBool('_reconnect_on_network_error', false)) reconnectFlags.push('-reconnect_on_network_error 1');
    const delayMax = sourceFormParams.value['_reconnect_delay_max'] ?? '5';
    reconnectFlags.push(`-reconnect_delay_max ${delayMax}`);

    const ffmpegArgs = `${reconnectFlags.join(' ')} -i ${streamUrl} -f s16le -ar ${rate || '48000'} -ac ${channels || '2'} -`;
    const encodedParams = encodeURIComponent(ffmpegArgs);

    const ffmpegInternalKeys = new Set(['_stream_url', 'name', '_reconnect', '_reconnect_streamed', '_reconnect_at_eof', '_reconnect_on_network_error', '_reconnect_delay_max']);
    params.push(`name=${encodeURIComponent(name)}`);
    for (const p of template.params) {
      if (ffmpegInternalKeys.has(p.key)) continue;
      const val = sourceFormParams.value[p.key];
      if (val !== undefined && val !== '' && val !== p.default) {
        params.push(`${p.key}=${encodeURIComponent(val)}`);
      }
    }
    params.push(`params=${encodedParams}`);
  } else {
    for (const p of template.params) {
      const val = sourceFormParams.value[p.key];
      if (val !== undefined && val !== '' && val !== p.default) {
        params.push(`${p.key}=${encodeURIComponent(val)}`);
      } else if (p.required && val) {
        params.push(`${p.key}=${encodeURIComponent(val)}`);
      }
    }
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
};

const addSourceFromTemplate = () => {
  const uri = buildSourceUri();
  if (!uri) return;

  // These are intentional mutations of the shared `localParsedConfig` /
  // `enabledProperties` objects the parent (ServerConfig.vue) also holds
  // and renders the Standard tab's property-editor loop from -- see the
  // file header comment for why this dialog is designed to mutate its
  // props directly instead of cloning + emitting a diff back up.
  /* eslint-disable vue/no-mutating-props */
  if (!props.localParsedConfig.stream) {
    props.localParsedConfig.stream = {};
  }

  if (isEditingSource.value && editingSourceIdx.value !== null) {
      const current = props.localParsedConfig.stream.source;
      if (Array.isArray(current)) {
          current[editingSourceIdx.value] = uri;
      } else {
          props.localParsedConfig.stream.source = uri;
      }
      uiStore.showToast('Source updated! Save to apply.', 'success');
  } else {
      const current = props.localParsedConfig.stream.source;
      if (Array.isArray(current)) {
        current.push(uri);
      } else if (current) {
        props.localParsedConfig.stream.source = [current, uri];
      } else {
        props.localParsedConfig.stream.source = uri;
      }
      uiStore.showToast('Source added! Save to apply.', 'success');
  }

  if (!props.enabledProperties.stream) props.enabledProperties.stream = {};
  props.enabledProperties.stream.source = true;
  /* eslint-enable vue/no-mutating-props */

  showAddSourceDialog.value = false;
};

const openAdd = () => {
  isEditingSource.value = false;
  editingSourceIdx.value = null;
  selectedSourceType.value = '';
  sourceFormPath.value = '';
  sourceFormParams.value = {};
  showAddSourceDialog.value = true;
};

const openEdit = (idx: number) => {
  isEditingSource.value = true;
  editingSourceIdx.value = idx;

  const sources = props.localParsedConfig.stream?.source;
  const uri = Array.isArray(sources) ? sources[idx] : sources;
  if (!uri) return;

  const typeMap: Record<string, string> = {
    'pipe://': 'pipe',
    'librespot://': 'librespot',
    'airplay://': 'airplay',
    'file://': 'file',
    'tcp://': 'tcp',
    'alsa://': 'alsa',
    'meta://': 'meta',
    'jack://': 'jack'
  };

  let detectedType = '';
  for (const [key, val] of Object.entries(typeMap)) {
      if (uri.startsWith(key)) {
          detectedType = val;
          break;
      }
  }
  if (uri.startsWith('process://')) {
      detectedType = uri.includes('ffmpeg') ? 'ffmpeg_radio' : 'process';
  }
  if (!detectedType) detectedType = 'pipe';

  selectSourceType(detectedType);

  const prefix = detectedType === 'ffmpeg_radio' || detectedType === 'process' ? 'process://' : `${detectedType}://`;
  const withoutPrefix = uri.substring(prefix.length);
  const qIdx = withoutPrefix.indexOf('?');
  let path = qIdx === -1 ? withoutPrefix : withoutPrefix.substring(0, qIdx);
  const query = qIdx === -1 ? '' : withoutPrefix.substring(qIdx + 1);

  if (path.startsWith('//')) {
      path = '/' + path.replace(/^\/+/, '');
  }

  sourceFormPath.value = path;
  const params = new URLSearchParams(query);
  sourceFormParams.value = {};

  for (const [key, val] of params.entries()) {
      sourceFormParams.value[key] = val;
  }

  if (detectedType === 'ffmpeg_radio') {
       const ffmpegParams = params.get('params') || '';
       const decoded = decodeURIComponent(ffmpegParams);
       const streamUrlMatch = decoded.match(/-i\s+([^\s]+)/);
       if (streamUrlMatch && streamUrlMatch[1]) {
           sourceFormParams.value['_stream_url'] = streamUrlMatch[1];
       }
       sourceFormParams.value['_reconnect']                = decoded.includes('-reconnect ') ? 'true' : 'false';
       sourceFormParams.value['_reconnect_streamed']       = decoded.includes('-reconnect_streamed') ? 'true' : 'false';
       sourceFormParams.value['_reconnect_at_eof']         = decoded.includes('-reconnect_at_eof') ? 'true' : 'false';
       sourceFormParams.value['_reconnect_on_network_error'] = decoded.includes('-reconnect_on_network_error') ? 'true' : 'false';
       const delayMatch = decoded.match(/-reconnect_delay_max\s+(\d+)/);
       if (delayMatch) sourceFormParams.value['_reconnect_delay_max'] = delayMatch[1] ?? '5';
  }

  // Parse meta-stream path into source list
  if (detectedType === 'meta') {
    metaSelectedSources.value = path
      .split('/')
      .filter((s: string) => s.length > 0);
  }

  showAddSourceDialog.value = true;
};

defineExpose({ openAdd, openEdit });
</script>

<template>
  <!-- ==================== ADD SOURCE DIALOG ==================== -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition ease-out duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition ease-in duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="showAddSourceDialog" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-black/80 backdrop-blur-md" @click="showAddSourceDialog = false"></div>
        <div class="relative bg-brand-bg rounded-2xl shadow-[0_0_30px_rgb(var(--brand-primary-rgb)/0.3)] border border-white/5 w-full max-w-2xl max-h-[85vh] overflow-y-auto">

          <!-- Header -->
          <div class="sticky top-0 bg-brand-bg/90 backdrop-blur-sm border-b border-white/5 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <div>
              <h3 class="text-sm font-black text-white uppercase tracking-widest drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{{ isEditingSource ? 'Edit Audio Source' : 'Add Audio Source' }}</h3>
              <p class="text-[10px] text-text-muted mt-0.5">{{ isEditingSource ? 'Modify the source parameters' : 'Select a source type and configure its parameters' }}</p>
            </div>
            <button @click="showAddSourceDialog = false" class="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-gray-500 hover:text-white rounded-lg hover:bg-white/5 transition-all" aria-label="Close">
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div class="p-6">
            <!-- Step 1: Source Type Selection -->
            <div v-if="!selectedSourceType">
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <button
                  v-for="tmpl in sourceTemplates"
                  :key="tmpl.type"
                  @click="selectSourceType(tmpl.type)"
                  class="flex flex-col items-center p-4 rounded-xl border border-white/5 bg-black/40 hover:border-brand-primary/50 hover:bg-brand-primary/10 transition-all group text-center shadow-lg"
                >
                  <div class="p-2 bg-white/5 border border-white/5 rounded-lg group-hover:bg-brand-primary/20 group-hover:border-brand-primary/30 transition-colors mb-2 shadow-[inset_0_0_10px_rgba(255,255,255,0.05)] group-hover:shadow-[inset_0_0_15px_rgba(166,13,242,0.3)]">
                    <span class="material-symbols-outlined text-[24px] text-gray-400 group-hover:text-brand-primary transition-colors drop-shadow-[0_0_5px_currentColor]">queue_music</span>
                  </div>
                  <span class="text-xs font-black uppercase tracking-wider text-gray-200 group-hover:text-white">{{ tmpl.label }}</span>
                  <span class="text-[9px] text-text-muted mt-1 leading-tight group-hover:text-gray-400">{{ tmpl.description.split('.')[0] }}</span>
                </button>
              </div>
            </div>

            <!-- Step 2: Parameter Form -->
            <div v-else-if="selectedTemplate">
              <button @click="selectedSourceType = ''" class="text-[10px] font-black text-brand-primary uppercase tracking-widest mb-4 hover:text-[#b526ff] hover:drop-shadow-[0_0_5px_rgba(166,13,242,0.5)] transition-all flex items-center">
                <span class="material-symbols-outlined text-[14px] mr-1">arrow_back</span>
                Back to source types
              </button>

              <div class="mb-5 p-4 bg-brand-primary/10 border border-brand-primary/20 rounded-xl">
                <div class="flex items-start space-x-3">
                  <span class="material-symbols-outlined text-[20px] text-brand-primary flex-shrink-0 mt-0.5">info</span>
                  <div>
                    <span class="text-xs font-black text-brand-primary uppercase tracking-widest drop-shadow-[0_0_5px_rgba(166,13,242,0.3)]">{{ selectedTemplate.label }}</span>
                    <p class="text-[10px] text-brand-primary/70 mt-1">{{ selectedTemplate.description }}</p>
                    <p v-if="selectedTemplate.fixedSampleFormat" class="text-[10px] text-amber-500/80 mt-2 font-black tracking-widest uppercase">
                      <span class="mr-1">⚠</span> Fixed sample format: {{ selectedTemplate.fixedSampleFormat }}
                    </p>
                  </div>
                </div>
              </div>

              <div class="space-y-4">
                <!-- Path (non-meta only) -->
                <div v-if="!selectedTemplate.isMeta">
                  <label class="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-1.5">
                    Path / Host
                  </label>
                  <input
                    v-model="sourceFormPath"
                    :placeholder="selectedTemplate.pathPlaceholder"
                    class="w-full text-sm font-mono px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                  />
                </div>

                <!-- ===== META STREAM: Source Picker ===== -->
                <div v-if="selectedTemplate.isMeta" class="space-y-4">
                  <!-- Available Sources -->
                  <div>
                    <label class="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">
                      <span class="material-symbols-outlined text-[12px] align-middle mr-1">library_music</span>
                      Available Sources
                    </label>
                    <div v-if="availableMetaSources.length === 0" class="border border-dashed border-white/10 rounded-xl bg-black/20">
                      <!-- No CTA here: creating a source happens in the separate "Audio
                           Sources" sub-section, not from within this meta-stream picker
                           (Task 33). -->
                      <EmptyState
                        icon="info"
                        title="No non-meta sources configured yet"
                        description="Add other audio sources first, then create a meta-stream to combine them."
                      />
                    </div>
                    <div v-else class="flex flex-wrap gap-2">
                      <button
                        v-for="srcName in availableMetaSources"
                        :key="srcName"
                        @click="addMetaSource(srcName)"
                        :disabled="metaSelectedSources.includes(srcName)"
                        :class="[
                          'inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border',
                          metaSelectedSources.includes(srcName)
                            ? 'bg-brand-primary/10 text-brand-primary/50 border-brand-primary/10 cursor-not-allowed'
                            : 'bg-black/40 text-gray-300 border-white/5 hover:border-[#00ff9d]/40 hover:bg-[#00ff9d]/10 hover:text-[#00ff9d] cursor-pointer'
                        ]"
                      >
                        <span class="material-symbols-outlined text-[14px]">{{ metaSelectedSources.includes(srcName) ? 'check_circle' : 'add_circle' }}</span>
                        <span>{{ srcName }}</span>
                      </button>
                    </div>
                  </div>

                  <!-- Selected Sources (priority order) -->
                  <div>
                    <label class="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">
                      <span class="material-symbols-outlined text-[12px] align-middle mr-1">sort</span>
                      Priority Chain
                      <span class="text-[9px] text-text-muted font-semibold normal-case tracking-normal ml-1">— first = highest priority (active), last = fallback</span>
                    </label>
                    <div v-if="metaSelectedSources.length === 0" class="text-center py-6 border border-dashed border-white/10 rounded-xl bg-black/20">
                      <span class="material-symbols-outlined text-[24px] text-gray-600">playlist_add</span>
                      <p class="text-[10px] text-text-muted mt-1 font-bold uppercase tracking-widest">Click sources above to add them</p>
                    </div>
                    <div v-else class="space-y-2">
                      <div
                        v-for="(srcName, idx) in metaSelectedSources"
                        :key="srcName + '-' + idx"
                        class="flex items-center space-x-2 px-3 py-2 rounded-xl border bg-black/30 transition-all"
                        :class="idx === 0 ? 'border-[#00ff9d]/30 bg-[#00ff9d]/5' : 'border-white/5'"
                      >
                        <!-- Priority badge -->
                        <span
                          :class="[
                            'flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black',
                            idx === 0
                              ? 'bg-[#00ff9d]/20 text-[#00ff9d] border border-[#00ff9d]/30'
                              : 'bg-white/5 text-text-muted border border-white/5'
                          ]"
                        >
                          {{ idx + 1 }}
                        </span>
                        <!-- Name -->
                        <span class="flex-1 text-sm font-bold" :class="idx === 0 ? 'text-[#00ff9d]' : 'text-gray-300'">{{ srcName }}</span>
                        <!-- Priority label -->
                        <span v-if="idx === 0" class="text-[8px] font-black uppercase tracking-widest text-[#00ff9d]/70 px-2 py-0.5 bg-[#00ff9d]/10 rounded border border-[#00ff9d]/20">Primary</span>
                        <span v-else-if="idx === metaSelectedSources.length - 1" class="text-[8px] font-black uppercase tracking-widest text-amber-500/70 px-2 py-0.5 bg-amber-500/10 rounded border border-amber-500/20">Fallback</span>
                        <!-- Move buttons -->
                        <button
                          @click="moveMetaSource(idx, 'up')"
                          :disabled="idx === 0"
                          class="p-1 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors"
                          :class="idx === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/10'"
                          :aria-label="`Move ${srcName} up`"
                        >
                          <span class="material-symbols-outlined text-[16px]">arrow_upward</span>
                        </button>
                        <button
                          @click="moveMetaSource(idx, 'down')"
                          :disabled="idx === metaSelectedSources.length - 1"
                          class="p-1 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors"
                          :class="idx === metaSelectedSources.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/10'"
                          :aria-label="`Move ${srcName} down`"
                        >
                          <span class="material-symbols-outlined text-[16px]">arrow_downward</span>
                        </button>
                        <!-- Remove -->
                        <button
                          @click="removeMetaSource(idx)"
                          class="p-1 min-w-[40px] min-h-[40px] flex items-center justify-center text-gray-500 hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-lg transition-colors"
                          :aria-label="`Remove ${srcName}`"
                        >
                          <span class="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Tip -->
                  <div class="p-3 bg-amber-500/5 border border-amber-500/15 rounded-xl">
                    <div class="flex items-start space-x-2">
                      <span class="material-symbols-outlined text-[14px] text-amber-500 mt-0.5 flex-shrink-0">tips_and_updates</span>
                      <p class="text-[10px] text-amber-400/80 leading-relaxed">
                        <strong class="text-amber-500">Tip:</strong> Use <code class="bg-black/40 px-1 py-0.5 rounded text-amber-300 font-mono border border-amber-500/10">codec=null</code> on sources that should <em>only</em> feed meta-streams and not appear as standalone streams for clients.
                      </p>
                    </div>
                  </div>
                </div>

                <!-- Parameters -->
                <div v-for="param in selectedTemplate.params" :key="param.key">
                  <label class="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-1.5">
                    {{ param.label }}
                    <span v-if="param.required" class="text-[#ff2a5f] ml-0.5 drop-shadow-[0_0_2px_rgba(255,42,95,0.8)]">*</span>
                  </label>
                  <span class="text-[9px] text-text-muted block mb-2">{{ param.description }}</span>

                  <!-- Boolean param -->
                  <div v-if="param.type === 'boolean'" class="flex items-center">
                    <button
                      @click="sourceFormParams[param.key] = sourceFormParams[param.key] === 'true' ? 'false' : 'true'"
                      :class="[
                        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:ring-2 focus:ring-brand-primary focus:outline-none focus:ring-offset-2 focus:ring-offset-brand-bg',
                        sourceFormParams[param.key] === 'true' ? 'bg-brand-primary shadow-[0_0_10px_rgb(var(--brand-primary-rgb)/0.4)]' : 'bg-gray-700'
                      ]"
                      :aria-label="sourceFormParams[param.key] === 'true' ? `Disable ${param.label}` : `Enable ${param.label}`"
                    >
                      <span :class="[sourceFormParams[param.key] === 'true' ? 'translate-x-5' : 'translate-x-0', 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200']" />
                    </button>
                    <span class="ml-3 text-xs text-gray-400 font-bold uppercase tracking-widest">
                      {{ sourceFormParams[param.key] === 'true' ? 'Yes' : 'No' }}
                    </span>
                  </div>

                  <!-- Select param -->
                  <div v-else-if="param.type === 'select'" class="relative">
                    <select
                      v-model="sourceFormParams[param.key]"
                      class="w-full text-sm font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-200 appearance-none pr-10"
                    >
                      <option v-for="opt in param.options" :key="opt" :value="opt" class="bg-black text-white">{{ opt }}</option>
                    </select>
                    <span class="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none text-[18px]">expand_more</span>
                  </div>

                  <!-- Number param -->
                  <input
                    v-else-if="param.type === 'number'"
                    type="number"
                    v-model="sourceFormParams[param.key]"
                    :placeholder="param.default || ''"
                    class="w-full text-sm font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                  />

                  <!-- Text param -->
                  <input
                    v-else
                    v-model="sourceFormParams[param.key]"
                    :placeholder="param.placeholder || param.default || ''"
                    class="w-full text-sm font-medium px-4 py-2 bg-black/40 border border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-300 placeholder-gray-600"
                  />
                </div>
              </div>

              <!-- URI Preview -->
              <div class="mt-6 p-4 bg-black/50 rounded-xl border border-white/5">
                <label class="text-[9px] font-black text-text-muted uppercase tracking-widest block mb-2">Generated URI</label>
                <code class="text-[11px] text-[#00d4ff] font-mono break-all leading-relaxed">{{ buildSourceUri() }}</code>
              </div>

              <!-- Actions -->
              <div class="flex justify-end space-x-3 mt-6">
                <button @click="showAddSourceDialog = false" class="px-5 py-2.5 text-xs font-black text-text-muted uppercase tracking-widest hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  @click="addSourceFromTemplate"
                  class="px-6 py-2.5 bg-brand-primary text-white border border-brand-primary/50 shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_20px_rgba(166,13,242,0.6)] rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#b526ff] active:scale-95 transition-all"
                >
                  {{ isEditingSource ? 'Update Source' : 'Add Source' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
