<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { useSnapclientInstancesStore, type SnapclientInstance, type AlsaControl } from '../stores/snapclientInstances';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const systemStore = useSystemStore();
const uiStore = useUIStore();
const instanceStore = useSnapclientInstancesStore();

// ── Modal state ──────────────────────────────────────────────────────────────
const showModal = ref(false);
const editingInstance = ref<SnapclientInstance | null>(null);

const form = ref({ name: '', host: '127.0.0.1', port: 1704, soundcard: '', hostId: '' });

function openCreate() {
  editingInstance.value = null;
  form.value = { name: '', host: '127.0.0.1', port: 1704, soundcard: '', hostId: '' };
  showModal.value = true;
}

function openEdit(inst: SnapclientInstance) {
  editingInstance.value = inst;
  form.value = { name: inst.name, host: inst.host, port: inst.port, soundcard: inst.soundcard, hostId: inst.hostId || '' };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingInstance.value = null;
}

// Available devices excluding already-used ones (except the current instance's own device)
const availableDevices = computed(() => {
  return instanceStore.devices.filter(d => {
    if (!d.inUse) return true;
    // Allow if this device belongs to the instance being edited
    return editingInstance.value?.soundcard === d.hwId;
  });
});

async function submitForm() {
  if (!form.value.name || !form.value.soundcard) {
    uiStore.showToast('Name and audio device are required.', 'error');
    return;
  }
  try {
    if (editingInstance.value) {
      await instanceStore.updateInstance(editingInstance.value.id, {
        name: form.value.name,
        host: form.value.host,
        port: form.value.port,
        soundcard: form.value.soundcard,
        hostId: form.value.hostId || undefined,
      });
      uiStore.showToast('Instance updated successfully!', 'success');
    } else {
      await instanceStore.createInstance({
        name: form.value.name,
        host: form.value.host,
        port: form.value.port,
        soundcard: form.value.soundcard,
        hostId: form.value.hostId || undefined,
      });
      uiStore.showToast('Instance created successfully!', 'success');
    }
    closeModal();
    await instanceStore.fetchDevices();
  } catch (err: any) {
    uiStore.showToast('Error: ' + err.message, 'error');
  }
}

async function handleDelete(inst: SnapclientInstance) {
  if (!confirm(`Delete instance "${inst.name}"? This will stop its service and remove all its files.`)) return;
  try {
    await instanceStore.deleteInstance(inst.id);
    uiStore.showToast(`Instance "${inst.name}" deleted.`, 'success');
    await instanceStore.fetchDevices();
  } catch (err: any) {
    uiStore.showToast('Delete failed: ' + err.message, 'error');
  }
}

async function handleControl(inst: SnapclientInstance, action: 'start' | 'stop' | 'restart') {
  try {
    await instanceStore.controlInstance(inst.id, action);
  } catch (err: any) {
    uiStore.showToast(`Failed to ${action} "${inst.name}": ` + err.message, 'error');
  }
}

async function handleUpdate(clean = false) {
  if (clean && !confirm('WARNING: This will UNINSTALL snapclient and DELETE its config before a fresh installation. Continue?')) return;
  try {
    await systemStore.updatePackage('snapclient', clean);
    uiStore.showToast(`snapclient ${clean ? 'reinstalled' : 'updated'} successfully!`, 'success');
  } catch (err: any) {
    uiStore.showToast(`Failed: ` + err.message, 'error');
  }
}

async function handleUninstall() {
  if (!confirm('Are you sure you want to UNINSTALL snapclient? All instances will be deleted.')) return;
  try {
    await systemStore.uninstallPackage('snapclient');
    uiStore.showToast('snapclient uninstalled successfully!', 'success');
    await systemStore.refreshAll();
  } catch (err: any) {
    uiStore.showToast('Failed: ' + err.message, 'error');
  }
}

// ── ALSA mixer state ─────────────────────────────────────────────────────
// Map of instanceId → { expanded, controls, saving }
const alsaState = ref<Record<string, { expanded: boolean; controls: AlsaControl[]; saving: boolean; saved: boolean }>>({});

function cardIdFromHwId(hwId: string): string {
  return (hwId.replace(/^hw:CARD=/, '').split(',')[0]) ?? hwId;
}

async function toggleAlsa(inst: SnapclientInstance) {
  if (!alsaState.value[inst.id]) {
    alsaState.value[inst.id] = { expanded: false, controls: [], saving: false, saved: false };
  }
  const state = alsaState.value[inst.id]!;
  state.expanded = !state.expanded;
  if (state.expanded && state.controls.length === 0) {
    const cardId = cardIdFromHwId(inst.soundcard);
    state.controls = await instanceStore.fetchAlsaControls(cardId).catch(() => []);
  }
}

async function handleAlsaChange(inst: SnapclientInstance, control: AlsaControl) {
  const state = alsaState.value[inst.id];
  if (!state) return;
  state.saving = true;
  state.saved = false;
  try {
    const cardId = cardIdFromHwId(inst.soundcard);
    await instanceStore.setAlsaVolume(cardId, control.name, control.percent);
    state.saved = true;
    setTimeout(() => { if (state) state.saved = false; }, 2000);
  } catch (err: any) {
    uiStore.showToast('ALSA error: ' + err.message, 'error');
  } finally {
    state.saving = false;
  }
}

onMounted(async () => {
  await systemStore.refreshAll();
  if (systemStore.installedPackages.snapclient) {
    await Promise.all([instanceStore.fetchInstances(), instanceStore.fetchDevices()]);
  }
});
</script>

<template>
  <Layout>
    <div class="relative min-h-[60vh] space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-black tracking-tight text-text-main">Client Dashboard</h1>
          <p class="text-text-muted font-medium mt-1">Manage Snapclient audio receiver instances.</p>
        </div>
        <button @click="systemStore.refreshAll()" :disabled="systemStore.loading" class="inline-flex items-center px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-brand-primary/30 active:scale-95 disabled:opacity-50 group border border-brand-primary/50">
          <span class="material-symbols-outlined text-[1.2rem] mr-2 transition-transform" :class="{'animate-spin': systemStore.loading, 'group-hover:rotate-180': !systemStore.loading}">refresh</span>
          SYNC ALL
        </button>
      </div>

      <!-- Loading Overlay -->
      <div v-if="systemStore.loading || instanceStore.loading" class="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg/40 backdrop-blur-sm pointer-events-none">
        <div class="bg-brand-surface/90 p-5 rounded-2xl shadow-2xl flex items-center space-x-3 border border-brand-primary/20 animate-in fade-in zoom-in duration-300 pointer-events-auto backdrop-blur-xl">
          <span class="material-symbols-outlined animate-spin text-brand-primary text-2xl">sync</span>
          <span class="text-sm font-bold text-white tracking-widest uppercase">{{ instanceStore.loadingMessage || systemStore.loadingMessage || 'Syncing...' }}</span>
        </div>
      </div>

      <!-- ── Snapclient Package Section ───────────────────────────────── -->
      <div class="flex items-center space-x-2 px-1">
        <span class="material-symbols-outlined text-brand-primary">speaker</span>
        <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">Snapclient Package</h2>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Snapclient">
          <template #icon><span class="material-symbols-outlined">speaker</span></template>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-gray-400">Installed</span>
              <span :class="systemStore.installedPackages.snapclient ? 'text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ff3b30] drop-shadow-[0_0_5px_rgba(255,59,48,0.5)]'" class="text-sm font-black">
                {{ systemStore.installedPackages.snapclient ? 'YES' : 'NO' }}
              </span>
            </div>
            <div v-if="systemStore.installedPackages.snapclient" class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Version</span>
                <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.snapclient || '...' }}</span>
              </div>
              <div v-if="systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown' && systemStore.packageVersions.snapclient !== systemStore.availableVersions.snapclient"
                   class="bg-[#ffcc00]/10 border border-[#ffcc00]/20 text-[#ffcc00] text-[10px] px-3 py-2 rounded-xl font-black flex items-center justify-between">
                <span>NEW VERSION: {{ systemStore.availableVersions.snapclient }}</span>
                <span class="w-2 h-2 rounded-full bg-[#ffcc00] animate-pulse"></span>
              </div>
              <div v-else-if="systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown'"
                   class="bg-[#00ff9d]/5 border border-[#00ff9d]/20 text-[#00ff9d] text-[10px] px-3 py-1.5 rounded-xl font-black text-center uppercase tracking-[0.2em]">
                UP TO DATE
              </div>
            </div>
            <div class="pt-4 border-t border-white/5 flex flex-col gap-2" v-if="systemStore.installedPackages.snapclient">
              <button @click="handleUpdate(systemStore.packageVersions.snapclient === systemStore.availableVersions.snapclient || systemStore.availableVersions.snapclient === 'unknown')"
                      :class="[
                        'w-full px-4 py-3 rounded-xl text-xs font-black tracking-widest transition-all active:scale-95 disabled:opacity-50 uppercase',
                        systemStore.packageVersions.snapclient !== systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown'
                        ? 'bg-brand-primary text-white border border-brand-primary/50 shadow-xl shadow-brand-primary/30 hover:bg-brand-primary/80'
                        : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white border border-white/5'
                      ]" :disabled="systemStore.loading">
                {{ systemStore.packageVersions.snapclient !== systemStore.availableVersions.snapclient && systemStore.availableVersions.snapclient !== 'unknown' ? 'Install Update' : 'Clean Reinstall' }}
              </button>
              <button @click="handleUninstall" class="w-full px-4 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                Uninstall
              </button>
            </div>
            <div class="pt-4 border-t border-white/5" v-else>
              <button @click="systemStore.installPackage('snapclient')" class="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black tracking-widest uppercase text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                Install Snapclient
              </button>
            </div>
          </div>
        </Card>
      </div>

      <!-- ── Instances Section ────────────────────────────────────────── -->
      <template v-if="systemStore.installedPackages.snapclient">
        <div class="border-t border-white/5 pt-8">
          <div class="flex items-center justify-between px-1 mb-6">
            <div class="flex items-center space-x-2">
              <span class="material-symbols-outlined text-brand-primary">dynamic_feed</span>
              <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">Output Instances</h2>
              <span class="ml-2 px-2 py-0.5 rounded-lg bg-brand-primary/10 border border-brand-primary/20 text-brand-primary text-[10px] font-black">{{ instanceStore.instances.length }}</span>
            </div>
            <button @click="openCreate" :disabled="instanceStore.loading" class="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-brand-primary/30 active:scale-95 disabled:opacity-50 border border-brand-primary/50">
              <span class="material-symbols-outlined text-[1rem]">add</span>
              New Instance
            </button>
          </div>

          <!-- Empty state -->
          <div v-if="instanceStore.instances.length === 0" class="flex flex-col items-center justify-center py-16 rounded-2xl border border-white/5 bg-white/[0.02] text-center">
            <span class="material-symbols-outlined text-[3rem] text-white/10 mb-3">speaker_notes_off</span>
            <p class="text-sm font-black text-white/20 uppercase tracking-widest">No instances configured</p>
            <p class="text-xs text-gray-600 mt-1">Create an instance for each audio output device.</p>
          </div>

          <!-- Instance cards -->
          <div v-else class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Card v-for="inst in instanceStore.instances" :key="inst.id" :title="inst.name">
              <template #icon>
                <span class="material-symbols-outlined">speaker</span>
              </template>
              <div class="space-y-3">
                <!-- Status row -->
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Status</span>
                  <span :class="inst.status === 'active' ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20' : 'text-[#ff3b30] bg-[#ff3b30]/10 border-[#ff3b30]/20'" class="px-2 py-0.5 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                    {{ inst.status ?? 'unknown' }}
                  </span>
                </div>
                <!-- Server + Instance number -->
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Server</span>
                  <span class="text-xs font-mono text-gray-300">{{ inst.host }}:{{ inst.port }}</span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-black text-gray-500 uppercase tracking-widest">Instance #</span>
                  <span class="text-xs font-mono text-brand-primary">{{ inst.instanceNum }}</span>
                </div>
                <!-- Soundcard -->
                <div class="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                  <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest block mb-1">Audio Output</span>
                  <span class="text-[11px] font-mono text-brand-primary break-all">{{ inst.soundcard }}</span>
                </div>

                <!-- ALSA Mixer toggle + panel -->
                <div class="rounded-xl border border-white/[0.06] overflow-hidden">
                  <button
                    @click="toggleAlsa(inst)"
                    class="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
                  >
                    <div class="flex items-center gap-2">
                      <span class="material-symbols-outlined text-[0.95rem] text-brand-primary">tune</span>
                      <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">ALSA Volume</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span v-if="alsaState[inst.id]?.saved" class="text-[9px] font-black text-[#00ff9d] uppercase tracking-widest">Saved</span>
                      <span v-if="alsaState[inst.id]?.saving" class="material-symbols-outlined text-[0.85rem] text-brand-primary animate-spin">sync</span>
                      <span class="material-symbols-outlined text-[0.85rem] text-gray-500 transition-transform" :class="alsaState[inst.id]?.expanded ? 'rotate-180' : ''">expand_more</span>
                    </div>
                  </button>

                  <Transition
                    enter-active-class="transition-all duration-200 ease-out"
                    enter-from-class="opacity-0 max-h-0"
                    enter-to-class="opacity-100 max-h-96"
                    leave-active-class="transition-all duration-150 ease-in"
                    leave-from-class="opacity-100 max-h-96"
                    leave-to-class="opacity-0 max-h-0"
                  >
                    <div v-if="alsaState[inst.id]?.expanded" class="px-3 py-3 space-y-3 border-t border-white/5 overflow-hidden">
                      <div v-if="alsaState[inst.id]?.controls.length === 0" class="text-[11px] text-gray-600 italic text-center py-2">
                        No playback controls found for this device.
                      </div>
                      <div v-for="ctrl in alsaState[inst.id]?.controls" :key="ctrl.name" class="space-y-1.5">
                        <div class="flex items-center justify-between">
                          <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ ctrl.name }}</span>
                          <span class="text-[11px] font-mono font-bold text-white">{{ ctrl.percent }}%</span>
                        </div>
                        <input
                          type="range"
                          min="0" max="100"
                          :value="ctrl.percent"
                          @input="ctrl.percent = parseInt(($event.target as HTMLInputElement).value)"
                          @change="handleAlsaChange(inst, ctrl)"
                          class="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/10"
                          style="accent-color: var(--brand-primary, #0ea5e9)"
                        />
                      </div>
                    </div>
                  </Transition>
                </div>

                <!-- Controls -->
                <div class="pt-3 border-t border-white/5 space-y-2">
                  <div class="grid grid-cols-3 gap-2">
                    <button @click="handleControl(inst, 'restart')" class="py-2 bg-black/40 hover:bg-white/10 text-white border border-white/5 rounded-xl transition-all text-[10px] font-bold active:scale-95" :disabled="instanceStore.loading">Restart</button>
                    <button v-if="inst.status === 'active'" @click="handleControl(inst, 'stop')" class="py-2 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-[10px] font-bold active:scale-95" :disabled="instanceStore.loading">Stop</button>
                    <button v-else @click="handleControl(inst, 'start')" class="py-2 bg-[#00ff9d]/10 hover:bg-[#00ff9d]/20 text-[#00ff9d] border border-[#00ff9d]/20 rounded-xl transition-all text-[10px] font-bold active:scale-95" :disabled="instanceStore.loading">Start</button>
                    <button @click="openEdit(inst)" class="py-2 bg-black/40 hover:bg-white/10 text-white border border-white/5 rounded-xl transition-all text-[10px] font-bold active:scale-95">Edit</button>
                  </div>
                  <button @click="handleDelete(inst)" class="w-full py-2 bg-[#ff3b30]/5 hover:bg-[#ff3b30]/15 text-[#ff3b30]/60 hover:text-[#ff3b30] border border-[#ff3b30]/10 rounded-xl transition-all text-[10px] font-bold active:scale-95" :disabled="instanceStore.loading">
                    Delete Instance
                  </button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </template>

      <!-- ── Create / Edit Modal ─────────────────────────────────────── -->
      <Transition enter-active-class="transition ease-out duration-200" enter-from-class="opacity-0" enter-to-class="opacity-100" leave-active-class="transition ease-in duration-150" leave-from-class="opacity-100" leave-to-class="opacity-0">
        <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="closeModal"></div>
          <div class="relative bg-brand-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200">
            <div class="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <h3 class="text-sm font-black text-white uppercase tracking-widest">{{ editingInstance ? 'Edit Instance' : 'New Instance' }}</h3>
              <button @click="closeModal" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                <span class="material-symbols-outlined text-[1.1rem]">close</span>
              </button>
            </div>

            <div class="p-6 space-y-4">
              <!-- Name -->
              <div>
                <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Instance Name</label>
                <input v-model="form.name" type="text" placeholder="e.g. Living Room DAC" class="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50" />
              </div>

              <!-- Audio Device -->
              <div>
                <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Audio Output Device</label>
                <div v-if="instanceStore.devices.length === 0" class="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] text-xs text-gray-500 italic">No ALSA devices detected. Make sure audio hardware is connected.</div>
                <div v-else class="space-y-2 max-h-48 overflow-y-auto pr-1">
                  <label v-for="d in availableDevices" :key="d.hwId"
                    :class="[
                      'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                      d.inUse && d.hwId !== form.soundcard
                        ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
                        : form.soundcard === d.hwId
                          ? 'border-brand-primary/50 bg-brand-primary/10'
                          : 'border-white/5 bg-white/[0.02] hover:border-brand-primary/30 hover:bg-white/[0.05]'
                    ]"
                  >
                    <input type="radio" :value="d.hwId" v-model="form.soundcard" :disabled="d.inUse && d.hwId !== form.soundcard" class="mt-0.5 accent-brand-primary" />
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-bold text-white truncate">{{ d.cardName }}</p>
                      <p class="text-[10px] text-gray-400">{{ d.deviceName }}</p>
                      <p class="text-[10px] font-mono text-brand-primary mt-0.5">{{ d.hwId }}</p>
                      <span v-if="d.inUse && d.hwId !== form.soundcard" class="inline-block mt-1 px-1.5 py-0.5 bg-[#ff3b30]/10 border border-[#ff3b30]/20 text-[#ff3b30] text-[9px] font-black rounded uppercase">In Use</span>
                    </div>
                  </label>
                </div>
              </div>

              <!-- Host + Port -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Snapserver Host</label>
                  <input v-model="form.host" type="text" placeholder="192.168.1.10" class="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50" />
                </div>
                <div>
                  <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Port</label>
                  <input v-model.number="form.port" type="number" placeholder="1704" class="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50" />
                </div>
              </div>

              <!-- Host ID -->
              <div>
                <label class="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1.5">Host ID <span class="text-gray-600 normal-case font-normal">(optional — for stable ID across reboots)</span></label>
                <input v-model="form.hostId" type="text" placeholder="e.g. living-room-dac" class="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-primary/50" />
              </div>
            </div>

            <div class="flex gap-3 px-6 pb-6">
              <button @click="closeModal" class="flex-1 py-3 bg-black/40 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5 rounded-xl text-xs font-black uppercase tracking-widest transition-all">Cancel</button>
              <button @click="submitForm" :disabled="!form.name || !form.soundcard || instanceStore.loading" class="flex-1 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-brand-primary/30 border border-brand-primary/50 disabled:opacity-50 active:scale-95">
                {{ editingInstance ? 'Save Changes' : 'Create Instance' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

    </div>
  </Layout>
</template>
