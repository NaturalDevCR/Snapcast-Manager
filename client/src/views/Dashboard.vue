<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSystemStore } from '../stores/system';
import { useUIStore } from '../stores/ui';
import { useSnapcastStore } from '../stores/snapcast';
import { useOnboardingStore } from '../stores/onboarding';
import { useHealthStore } from '../stores/health';
import { useDiagnosticsStore } from '../stores/diagnostics';
import { useEventSource } from '../composables/useEventSource';
import { sseStatusBadge } from '../utils/sseStatus';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';
import Badge from '../components/ui/Badge.vue';
import ConfirmDestructive from '../components/ui/ConfirmDestructive.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import JobLogPanel from '../components/JobLogPanel.vue';
import { version } from '../../package.json';

const { t } = useI18n({ useScope: 'global' });
const systemStore = useSystemStore();
const uiStore = useUIStore();
const snapcastStore = useSnapcastStore();
const onboardingStore = useOnboardingStore();
const healthStore = useHealthStore();
const diagnosticsStore = useDiagnosticsStore();

// Task 29: snapcast state updates now arrive via the app-wide SSE
// connection (Task 28, connected/disconnected by App.vue) instead of this
// view polling `snapcastStore.fetchStatus()` on its own timer -- see
// useEventSource.ts's applySnapcastUpdate(), which writes to the exact same
// `snapcastStore.status` field this view already reads. The live/
// reconnecting indicator below surfaces that connection's own status.
const sse = useEventSource();

const selectedNodeVersion = ref('20');

onMounted(async () => {
  await systemStore.refreshAll();
  systemStore.fetchMympdInfo();
  // Task 50: resume-onboarding banner below reads onboardingStore.step/
  // dismissed -- Onboarding.vue also calls fetchOnboarding() on its own
  // mount, but that's a separate visit; Dashboard needs its own fetch so
  // the banner is correct on a fresh Dashboard load too (Pinia stores are
  // singletons, so this doesn't double up with -- or fight -- that other
  // call, it's just the same store being kept in sync from both views).
  onboardingStore.fetchOnboarding();

  // Auto-select current installed Node.js version
  if (systemStore.packageVersions.node) {
    const match = systemStore.packageVersions.node.match(/v?(\d+)/);
    if (match && match[1]) {
      selectedNodeVersion.value = match[1];
    }
  }

  // Fast first paint before the SSE connection's first `snapcast` event
  // arrives -- the connection is app-wide/shared, so it may already be
  // connected and have fresh data by the time this view mounts, but this
  // explicit fetch is a safety net for that initial window.
  snapcastStore.fetchStatus();

  // Task 58: compact health panel below reads healthStore.detail, backed
  // by the authenticated GET /api/health/detail (Task 57). No polling --
  // fetched once on mount plus whenever the panel's own refresh button is
  // clicked (handleHealthRefresh below).
  healthStore.fetchHealthDetail();

  // Task 63: self-diagnostics summary badge below the Health Panel, backed
  // by the authenticated GET /api/diagnostics (Task 62). Same no-polling
  // discipline as the health panel above -- fetched once on mount, no
  // refresh control here (the full list + manual refresh lives on
  // Diagnostics.vue, which this badge links to).
  diagnosticsStore.fetchDiagnostics();
});

const handleHealthRefresh = () => {
  healthStore.fetchHealthDetail();
};

// Task 58: disk.freePercent is only present on the success branch of the
// backend's discriminated union (disk.error on the failure branch) -- this
// mirrors that shape rather than assuming the success fields are always set.
const diskFreePercent = computed(() => {
  const disk = healthStore.detail?.disk;
  return disk && 'freePercent' in disk ? disk.freePercent : null;
});

type UpdatablePackage = 'snapserver' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'mpd' | 'mympd';
type UninstallablePackage = 'shairport-sync' | 'mpd' | 'mympd';

// ── Clean reinstall (destructive: deletes config first) ─────────────────
const showConfirmReinstall = ref(false);
const pendingReinstallPkg = ref<UpdatablePackage | null>(null);

const handleUpdate = (pkg: UpdatablePackage, clean: boolean = false) => {
  if (clean) {
    pendingReinstallPkg.value = pkg;
    showConfirmReinstall.value = true;
    return;
  }
  performUpdate(pkg, false);
};

const performUpdate = async (pkg: UpdatablePackage, clean: boolean) => {
  try {
    await systemStore.updatePackage(pkg, clean);
    uiStore.showToast(
      clean
        ? t('dashboard.packageReinstalledSuccess', { pkg })
        : t('dashboard.packageUpdatedSuccess', { pkg }),
      'success',
    );
  } catch (err: any) {
    uiStore.showToast(
      (clean ? t('dashboard.packageReinstallFailed', { pkg }) : t('dashboard.packageUpdateFailed', { pkg })) +
        err.message,
      'error',
    );
  }
};

// ── Uninstall (destructive: removes binaries and service files) ─────────
const showConfirmUninstall = ref(false);
const pendingUninstallPkg = ref<UninstallablePackage | null>(null);

const handleUninstall = (pkg: UninstallablePackage) => {
  pendingUninstallPkg.value = pkg;
  showConfirmUninstall.value = true;
};

const performUninstall = async () => {
  const pkg = pendingUninstallPkg.value;
  if (!pkg) return;
  try {
    await systemStore.uninstallPackage(pkg);
    uiStore.showToast(t('dashboard.packageUninstalledSuccess', { pkg }), 'success');
    await systemStore.refreshAll(); // Refresh status
  } catch (err: any) {
    uiStore.showToast(t('dashboard.packageUninstallFailed', { pkg }) + err.message, 'error');
  } finally {
    pendingUninstallPkg.value = null;
  }
};

// ── Update Node.js (disruptive, NOT data-destructive: no deletion) ──────
const showConfirmUpdateNode = ref(false);

const triggerUpdateNodeJs = () => {
  showConfirmUpdateNode.value = true;
};

const handleUpdateNodeJs = async () => {
    try {
        await systemStore.updateNodeJs(selectedNodeVersion.value);
        uiStore.showToast(
          t('dashboard.nodeUpdateInitiatedSuccess', { version: selectedNodeVersion.value }),
          'success',
        );
    } catch (err: any) {
        uiStore.showToast(t('dashboard.nodeUpdateFailed') + err.message, 'error');
    }
};

const openMympd = () => {
    window.open(systemStore.mympdUrl, '_blank', 'noopener');
};

</script>

<template>
  <Layout>
    <div class="relative min-h-[60vh] space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <!-- Header Section -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-3xl font-black tracking-tight text-text-main">{{ t('dashboard.headerTitle') }}</h1>
            <Badge :variant="sseStatusBadge(sse.status.value).variant" size="sm">{{ sseStatusBadge(sse.status.value).label }}</Badge>
          </div>
          <p class="text-text-muted font-medium mt-1">{{ t('dashboard.headerSubtitle') }}</p>
        </div>
        <button @click="systemStore.refreshAll()" :disabled="systemStore.loading" class="inline-flex items-center px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xl shadow-brand-primary/30 active:scale-95 disabled:opacity-50 group border border-brand-primary/50">
          <span class="material-symbols-outlined text-[1.2rem] mr-2 transition-transform" :class="{'animate-spin': systemStore.loading, 'group-hover:rotate-180': !systemStore.loading}">refresh</span>
          {{ t('dashboard.syncAllButton') }}
        </button>
      </div>

      <!-- Resume-onboarding banner (Task 50): visible whenever the wizard
           hasn't reached step 3 (complete) and the admin hasn't dismissed
           it. Dismissible via the wizard's own "Skip for now"/completion
           flow, not from here -- clicking through resumes at whatever step
           onboardingStore.step already holds. -->
      <div v-if="onboardingStore.step < 3 && !onboardingStore.dismissed"
           class="flex items-center justify-between p-4 bg-brand-primary/10 border border-brand-primary/30 rounded-lg">
        <span class="text-sm font-bold text-text-main">{{ t('dashboard.resumeBannerText') }}</span>
        <router-link to="/onboarding" class="text-xs font-black text-brand-primary uppercase tracking-widest hover:underline">
          {{ t('dashboard.resumeBannerLink') }}
        </router-link>
      </div>

      <!-- Health Panel (Task 58): compact, always-visible summary of the
           5 checks GET /api/health/detail (Task 57) reports. systemd
           active-state and RPC-connected-state are deliberately shown as
           two distinct signals per the backend's own design -- a service
           can be systemd-active but not yet RPC-connected (or vice versa)
           during a restart. -->
      <Card :title="t('dashboard.healthPanelTitle')">
        <template #icon>
          <span class="material-symbols-outlined text-xl">monitor_heart</span>
        </template>
        <template #action>
          <button
            @click="handleHealthRefresh"
            :disabled="healthStore.loading"
            :aria-label="t('dashboard.healthRefreshAria')"
            class="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] text-text-muted hover:text-text-main border border-black/[0.05] dark:border-white/[0.05] transition-all active:scale-95 disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-[1rem]" :class="{ 'animate-spin': healthStore.loading }">refresh</span>
          </button>
        </template>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col space-y-1">
            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.healthSystemdLabel') }}</span>
            <span :class="healthStore.detail?.snapserver?.systemdActive ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-xs font-black uppercase tracking-wide">
              {{ healthStore.detail?.snapserver?.systemdActive ? t('dashboard.healthActiveStatus') : t('dashboard.healthInactiveStatus') }}
            </span>
          </div>
          <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col space-y-1">
            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.healthRpcLabel') }}</span>
            <span :class="healthStore.detail?.snapserver?.rpcConnected ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-xs font-black uppercase tracking-wide">
              {{ healthStore.detail?.snapserver?.rpcConnected ? t('dashboard.healthConnectedStatus') : t('dashboard.healthDisconnectedStatus') }}
            </span>
          </div>
          <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col space-y-1">
            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.healthDiskLabel') }}</span>
            <span :class="diskFreePercent !== null && diskFreePercent < 10 ? 'text-[#ff3b30]' : 'text-emerald-400'" class="text-xs font-black uppercase tracking-wide">
              {{ diskFreePercent !== null ? t('dashboard.healthDiskFreeValue', { percent: diskFreePercent }) : t('dashboard.healthDiskUnknownStatus') }}
            </span>
          </div>
          <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col space-y-1">
            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.healthPermissionsLabel') }}</span>
            <span :class="healthStore.detail?.permissions?.snapshotsDirWritable ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-xs font-black uppercase tracking-wide">
              {{ healthStore.detail?.permissions?.snapshotsDirWritable ? t('dashboard.healthWritableYes') : t('dashboard.healthWritableNo') }}
            </span>
          </div>
          <div class="col-span-2 sm:col-span-4 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col space-y-1">
            <div class="flex items-center justify-between">
              <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.healthConfigLabel') }}</span>
              <span :class="healthStore.detail?.config?.parseable ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-xs font-black uppercase tracking-wide">
                {{ healthStore.detail?.config?.parseable ? t('dashboard.healthConfigParseableStatus') : t('dashboard.healthConfigErrorStatus') }}
              </span>
            </div>
            <p v-if="healthStore.detail?.config && !healthStore.detail.config.parseable" class="text-[10px] font-mono text-[#ff3b30]/80">
              {{ healthStore.detail.config.error }}
            </p>
          </div>
        </div>

        <!-- Diagnostics summary badge (Task 63): honest indicator linking to
             the full self-diagnostics view, not a duplicate list here. A
             failed fetch (diagnosticsStore.error set) must NOT collapse into
             the same "all clear" state a genuine 0-findings result shows --
             that would silently reassure an admin during exactly the kind of
             connectivity/auth problem this panel exists to surface (see
             Task 63 review). -->
        <div class="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
          <router-link
            v-if="diagnosticsStore.error"
            to="/diagnostics"
            class="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            <span class="material-symbols-outlined text-[1rem]">help</span>
            {{ t('dashboard.diagnosticsUnknown') }}
          </router-link>
          <router-link
            v-else-if="diagnosticsStore.findings.length > 0"
            to="/diagnostics"
            class="inline-flex items-center gap-1.5 text-xs font-bold text-[#ffcc00] hover:text-[#ffcc00]/80 transition-colors"
          >
            <span class="material-symbols-outlined text-[1rem]">warning</span>
            {{ t('dashboard.diagnosticsIssuesFound', { count: diagnosticsStore.findings.length }) }}
          </router-link>
          <span v-else class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400">
            <span class="material-symbols-outlined text-[1rem]">check_circle</span>
            {{ t('dashboard.diagnosticsAllClear') }}
          </span>
        </div>
      </Card>

      <!-- Loading overlay + full job log window (JobLogPanel.vue) -->
      <JobLogPanel />


      <!-- Enhanced Snapcast Live Metrics -->
      <div v-if="snapcastStore.status && systemStore.snapcastMode !== 'client'" class="space-y-6">
        <div class="flex items-center space-x-3 px-2">
            <div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <h2 class="text-[10px] font-black text-text-muted uppercase tracking-[0.4em]">{{ t('dashboard.liveMetricsHeading') }}</h2>
        </div>
        
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <!-- Streams Card -->
            <Card :title="t('dashboard.streamsCardTitle')">
                <template #icon>
                    <span class="material-symbols-outlined text-xl">music_note</span>
                </template>
                <div class="flex flex-col">
                    <div class="flex items-baseline space-x-2 mb-4">
                        <span class="text-5xl font-black text-text-main tracking-tighter">
                            {{ snapcastStore.status.streams.length }}
                        </span>
                        <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.streamsAvailableLabel') }}</span>
                    </div>
                    
                    <div class="space-y-2 max-h-[140px] overflow-y-auto pr-2 custom-scrollbar">
                        <div v-for="stream in snapcastStore.status.streams" :key="stream.id"
                             class="group/item flex items-center justify-between p-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] hover:border-brand-primary/30 transition-all duration-300">
                            <div class="flex items-center space-x-3 min-w-0">
                                <div class="w-1.5 h-1.5 rounded-full transition-colors" :class="stream.status === 'playing' ? 'bg-emerald-400' : 'bg-black/10 dark:bg-white/10'"></div>
                                <span class="text-xs font-semibold text-text-main/70 truncate group-hover/item:text-text-main transition-colors" :title="stream.id">
                                    {{ stream.uri?.query?.name || stream.id }}
                                </span>
                            </div>
                            <span :class="stream.status === 'playing' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-text-muted bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10'"
                                  class="px-2 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider transition-all">
                                {{ stream.status }}
                            </span>
                        </div>
                        <div v-if="snapcastStore.status.streams.length === 0" class="flex flex-col items-center justify-center py-6 text-text-muted/40 italic">
                            <span class="material-symbols-outlined text-2xl mb-1">music_off</span>
                            <span class="text-[10px] uppercase font-black tracking-widest">{{ t('dashboard.streamsEmpty') }}</span>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Clients Card -->
            <Card :title="t('dashboard.clientsCardTitle')">
                <template #icon>
                    <span class="material-symbols-outlined text-xl">sensors</span>
                </template>
                <div class="flex flex-col">
                    <div class="flex items-baseline space-x-2 mb-4">
                        <span class="text-5xl font-black text-text-main tracking-tighter">
                            {{ snapcastStore.status.groups.reduce((acc, g) => acc + g.clients.filter(c => c.connected).length, 0) }}
                        </span>
                        <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.clientsConnectedLabel') }}</span>
                    </div>

                    <div class="space-y-2 max-h-[140px] overflow-y-auto pr-2 custom-scrollbar">
                        <template v-for="group in snapcastStore.status.groups" :key="group.id">
                            <div v-for="client in group.clients.filter(c => c.connected)" :key="client.id" 
                                 class="group/item flex items-center justify-between p-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] hover:border-brand-primary/30 transition-all duration-300">
                                <div class="flex flex-col min-w-0">
                                    <span class="text-xs font-semibold text-text-main/70 truncate group-hover/item:text-text-main transition-colors">
                                        {{ client.config.name || client.host.name }}
                                    </span>
                                    <span class="text-[9px] text-text-muted font-mono mt-0.5">{{ client.host.ip }}</span>
                                </div>
                                <div class="flex items-center space-x-2">
                                    <div class="h-1 w-12 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                                        <div class="h-full bg-brand-primary transition-all duration-500" :style="{ width: client.config.volume.percent + '%', opacity: client.config.volume.muted ? 0.2 : 1 }"></div>
                                    </div>
                                    <span :class="client.config.volume.muted ? 'text-[#ff3b30]' : 'text-brand-primary'" class="text-[9px] font-black w-6 text-right">
                                        {{ client.config.volume.muted ? t('dashboard.volumeMutedLabel') : client.config.volume.percent }}
                                    </span>
                                </div>
                            </div>
                        </template>
                        <div v-if="snapcastStore.status.groups.reduce((acc, g) => acc + g.clients.filter(c => c.connected).length, 0) === 0"
                             class="flex flex-col items-center justify-center py-6 text-text-muted/40 italic">
                            <span class="material-symbols-outlined text-2xl mb-1">link_off</span>
                            <span class="text-[10px] uppercase font-black tracking-widest">{{ t('dashboard.clientsEmpty') }}</span>
                        </div>
                    </div>
                </div>
            </Card>

            <!-- Server State Card -->
            <Card :title="t('dashboard.coreEngineCardTitle')">
                <template #icon>
                    <span class="material-symbols-outlined text-xl">settings_input_component</span>
                </template>
                <div class="space-y-4">
                    <!-- Master Status Indicator -->
                    <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="relative flex h-2.5 w-2.5">
                                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40"></span>
                                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                            </div>
                            <span class="text-xs font-bold text-text-main uppercase tracking-widest">{{ t('dashboard.systemNormalLabel') }}</span>
                        </div>
                        <span class="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest">{{ t('dashboard.operationalLabel') }}</span>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col items-center justify-center text-center space-y-1">
                            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.versionLabel') }}</span>
                            <span class="text-xs font-mono font-semibold text-brand-primary group-hover:text-text-main transition-colors">
                                {{ systemStore.packageVersions.snapserver || (snapcastStore.status ? snapcastStore.status.server.version : '...') }}
                            </span>
                        </div>
                        <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] flex flex-col items-center justify-center text-center space-y-1">
                            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.groupsLabel') }}</span>
                            <span class="text-xs font-semibold text-text-main">
                                {{ snapcastStore.status.groups.length }}
                            </span>
                        </div>
                    </div>

                    <div class="pt-1">
                        <div class="flex justify-between items-center mb-1.5 px-1">
                            <span class="text-[9px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.healthLabel') }}</span>
                            <span class="text-[9px] font-bold text-emerald-400">100%</span>
                        </div>
                        <div class="h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                            <div class="h-full bg-brand-primary w-full"></div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
      </div>
      
      <!-- System/Daemon Offline State -->
      <div v-else-if="!snapcastStore.loading && snapcastStore.error" class="bg-[#ff3b30]/10 border border-[#ff3b30]/30 rounded-2xl p-8 text-center backdrop-blur-xl shadow-[0_0_30px_rgba(255,59,48,0.1)]">
          <span class="material-symbols-outlined text-[3rem] text-[#ff3b30] drop-shadow-[0_0_15px_rgba(255,59,48,0.5)] mb-4">cloud_off</span>
          <h3 class="text-sm font-black text-text-main uppercase tracking-[0.2em] mb-2">{{ t('dashboard.snapserverOfflineTitle') }}</h3>
          <p class="text-xs text-gray-400 max-w-md mx-auto">{{ snapcastStore.error }}</p>
      </div>

      <div class="border-t border-black/5 dark:border-white/5 my-10"></div>

      <!-- System Services Category -->
      <div class="flex items-center space-x-2 px-1 mb-4">
          <span class="material-symbols-outlined text-brand-primary">settings_system_daydream</span>
          <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">{{ t('dashboard.coreServicesHeading') }}</h2>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-12">
      <Card v-if="systemStore.snapcastMode !== 'client'" :title="t('dashboard.snapserverCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">router</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.snapserverInstalledLabel') }}</span>
                <span :class="systemStore.installedPackages.snapserver ? 'text-[#00ff9d] drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]' : 'text-[#ff3b30] drop-shadow-[0_0_5px_rgba(255,59,48,0.5)]'" class="text-sm font-black">
                    {{ systemStore.installedPackages.snapserver ? t('dashboard.snapserverInstalledYes') : t('dashboard.snapserverInstalledNo') }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages.snapserver">
                 <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.statusLabel') }}</span>
                 <span :class="systemStore.snapserverStatus === 'active' ? 'text-[#00ff9d] bg-[#00ff9d]/10 border-[#00ff9d]/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                     {{ systemStore.snapserverStatus }}
                 </span>
            </div>
            <div class="flex flex-col" v-if="systemStore.installedPackages.snapserver">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-text-muted uppercase tracking-widest">{{ t('dashboard.versionLabel') }}</span>
                    <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.snapserver || '...' }}</span>
                 </div>
                 <div v-if="systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown' && systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver"
                       class="mt-2 bg-[#ffcc00]/10 border border-[#ffcc00]/20 text-[#ffcc00] text-[10px] px-3 py-2 rounded-xl font-black flex items-center justify-between">
                     <span>{{ t('dashboard.newVersionAvailable', { version: systemStore.availableVersions.snapserver }) }}</span>
                     <span class="w-2 h-2 rounded-full bg-[#ffcc00] animate-pulse"></span>
                 </div>
                 <div v-else-if="systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown'"
                       class="mt-2 bg-[#00ff9d]/5 border border-[#00ff9d]/20 text-[#00ff9d] text-[10px] px-3 py-1.5 rounded-xl font-black font-sans uppercase tracking-[0.2em] text-center drop-shadow-[0_0_5px_rgba(0,255,157,0.3)]">
                     {{ t('dashboard.upToDateLabel') }}
                 </div>
            </div>

            <div class="pt-4 flex flex-col space-y-3 border-t border-black/5 dark:border-white/5" v-if="systemStore.installedPackages.snapserver">
                <div class="grid grid-cols-2 gap-3">
                    <button @click="systemStore.controlService('restart', 'snapserver')" class="px-3 py-2.5 bg-black/40 hover:bg-black/10 dark:hover:bg-white/10 text-text-main border border-black/5 dark:border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.restartButton') }}</button>
                    <button v-if="systemStore.snapserverStatus === 'active'" @click="systemStore.controlService('stop', 'snapserver')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.stopButton') }}</button>
                    <button v-else @click="systemStore.controlService('start', 'snapserver')" class="px-3 py-2.5 bg-[#00ff9d]/10 hover:bg-[#00ff9d]/20 text-[#00ff9d] border border-[#00ff9d]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.startButton') }}</button>
                </div>
                <button @click="handleUpdate('snapserver', systemStore.packageVersions.snapserver === systemStore.availableVersions.snapserver || systemStore.availableVersions.snapserver === 'unknown')"
                        :class="[
                            'w-full px-4 py-3 rounded-xl text-xs font-black tracking-widest transition-all active:scale-95 disabled:opacity-50 uppercase',
                            systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown'
                            ? 'bg-brand-primary text-white border border-brand-primary/50 shadow-xl shadow-brand-primary/30 hover:shadow-brand-primary/50 hover:bg-brand-primary/80'
                            : 'bg-black/40 text-gray-400 hover:bg-black/10 dark:hover:bg-white/10 hover:text-text-main border border-black/5 dark:border-white/5'
                        ]"
                        :disabled="systemStore.loading">
                    {{ systemStore.packageVersions.snapserver !== systemStore.availableVersions.snapserver && systemStore.availableVersions.snapserver !== 'unknown' ? t('dashboard.installUpdateButton') : t('dashboard.cleanReinstallLabel') }}
                </button>
            </div>
            <div class="pt-4 border-t border-black/5 dark:border-white/5" v-else>
                 <button @click="systemStore.installPackage('snapserver')" class="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black tracking-widest uppercase text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.installSnapserverButton') }}</button>
            </div>
        </div>
      </Card>


      <Card :title="t('dashboard.runtimeCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">javascript</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.nodeJsLabel') }}</span>
                <span class="text-[#00ff9d] font-black text-sm tracking-widest leading-none drop-shadow-[0_0_5px_rgba(0,255,157,0.5)]">
                    {{ systemStore.packageVersions.node || t('dashboard.nodeUnknownLabel') }}
                </span>
            </div>
            <div class="flex flex-col">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-text-muted uppercase tracking-widest">{{ t('dashboard.engineVersionLabel') }}</span>
                    <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions.node || '...' }}</span>
                 </div>

                 <div class="mt-4 space-y-3">
                    <span class="text-[10px] font-black text-text-muted uppercase tracking-widest block border-b border-black/5 dark:border-white/5 pb-2">{{ t('dashboard.selectLtsLabel') }}</span>
                    <div class="grid grid-cols-3 gap-3">
                        <button v-for="v in ['18', '20', '22']" :key="v"
                                @click="selectedNodeVersion = v"
                                :class="[
                                    'py-2.5 rounded-xl text-xs font-black transition-all border',
                                    selectedNodeVersion === v
                                    ? 'bg-[#00ff9d]/10 border-[#00ff9d]/30 text-[#00ff9d] drop-shadow-[0_0_8px_rgba(0,255,157,0.4)]'
                                    : 'bg-black/40 border-black/5 dark:border-white/5 text-gray-400 hover:border-black/20 dark:hover:border-white/20 hover:text-gray-300'
                                ]"
                        >
                            v{{ v }}
                        </button>
                    </div>
                 </div>
            </div>
            <div class="pt-5 border-t border-black/5 dark:border-white/5">
                 <button @click="triggerUpdateNodeJs" class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.updateNodeButton', { version: selectedNodeVersion }) }}
                 </button>
            </div>
        </div>
      </Card>

      <Card :title="t('dashboard.managementCoreCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">dashboard_customize</span>
        </template>
        <div class="space-y-4 h-full flex flex-col">
            <div class="flex flex-col space-y-2 flex-grow">
                <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">{{ t('dashboard.appVersionLabel') }}</span>
                <span class="text-3xl font-black text-text-main">v{{ version }}</span>
            </div>
            <div class="p-3 bg-brand-primary/5 border border-brand-primary/20 rounded-xl shadow-inner shadow-brand-primary/10 mt-auto mb-4">
                <p class="text-[10px] font-bold text-brand-primary leading-relaxed text-center tracking-widest uppercase">{{ t('dashboard.syncedMessage', { version }) }}</p>
            </div>
            <div class="pt-4 border-t border-black/5 dark:border-white/5">
                 <button disabled class="w-full px-4 py-3 bg-black/40 text-text-muted rounded-xl font-black text-xs uppercase tracking-widest cursor-default border border-black/5 dark:border-white/5">
                    {{ t('dashboard.uiUpToDateButton') }}
                 </button>
            </div>
        </div>
      </Card>

      </div>

      <!-- Audio Plugins & Remotes Category -->
      <div class="flex items-center space-x-2 px-1 mb-4 mt-12">
          <span class="material-symbols-outlined text-brand-primary">settings_input_antenna</span>
          <h2 class="text-sm font-bold text-text-main uppercase tracking-widest">{{ t('dashboard.audioPluginsHeading') }}</h2>
      </div>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <Card v-if="systemStore.snapcastMode !== 'client'" :title="t('dashboard.snapCtrlCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">api</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.statusLabel') }}</span>
                <span :class="systemStore.installedPackages['snap-ctrl'] ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                    {{ systemStore.installedPackages['snap-ctrl'] ? t('dashboard.installedBadge') : t('dashboard.notInstalledBadge') }}
                </span>
            </div>
            <div class="flex flex-col">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-text-muted uppercase tracking-widest">{{ t('dashboard.versionLabel') }}</span>
                    <span class="text-xs font-mono font-bold text-gray-300">{{ systemStore.packageVersions['snap-ctrl'] || '...' }}</span>
                 </div>
                 <div v-if="systemStore.availableVersions['snap-ctrl'] && systemStore.availableVersions['snap-ctrl'] !== 'unknown' && systemStore.packageVersions['snap-ctrl'] !== systemStore.availableVersions['snap-ctrl']"
                       class="mt-2 bg-[#ffcc00]/10 border border-[#ffcc00]/20 text-[#ffcc00] text-[10px] px-3 py-2 rounded-xl font-black flex items-center justify-between">
                     <span>{{ t('dashboard.updateReadyLabel') }}</span>
                     <span class="w-2 h-2 rounded-full bg-[#ffcc00] animate-pulse"></span>
                 </div>
            </div>
            <p class="text-[11px] font-medium text-text-muted leading-relaxed">{{ t('dashboard.snapCtrlDescription') }}</p>
            <div class="pt-3 border-t border-black/5 dark:border-white/5">
                 <button @click="handleUpdate('snap-ctrl')" class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ systemStore.installedPackages['snap-ctrl'] ? t('dashboard.updateInterfaceButton') : t('dashboard.installInterfaceButton') }}
                 </button>
            </div>
            <p v-if="systemStore.installedPackages['snap-ctrl']" class="text-[10px] font-black text-center text-text-muted uppercase tracking-widest">
                {{ t('dashboard.snapCtrlPort') }}
            </p>
        </div>
      </Card>

      <Card :title="t('dashboard.ffmpegCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">movie_creation</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.toolkitLabel') }}</span>
                <span :class="systemStore.installedPackages.ffmpeg ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-sm font-black">
                    {{ systemStore.installedPackages.ffmpeg ? t('dashboard.readyLabel') : t('dashboard.absentLabel') }}
                </span>
            </div>
            <div class="flex flex-col" v-if="systemStore.installedPackages.ffmpeg">
                 <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] font-black text-text-muted uppercase tracking-widest">{{ t('dashboard.versionInfoLabel') }}</span>
                    <span class="text-xs font-mono font-bold text-gray-300 truncate max-w-[150px]">{{ systemStore.packageVersions.ffmpeg || '...' }}</span>
                 </div>
            </div>
            <div class="pt-3 border-t border-black/5 dark:border-white/5" v-if="!systemStore.installedPackages.ffmpeg">
                 <button @click="systemStore.installPackage('ffmpeg')" class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.installFfmpegButton') }}
                 </button>
            </div>
            <div class="pt-4 flex flex-col space-y-4 border-t border-black/5 dark:border-white/5" v-else>
                <div class="p-3 bg-brand-primary/5 border border-brand-primary/20 rounded-xl shadow-inner shadow-brand-primary/10">
                    <p class="text-[10px] font-bold text-brand-primary uppercase tracking-widest leading-relaxed text-center">{{ t('dashboard.ffmpegDescription') }}</p>
                </div>
                <button @click="handleUpdate('ffmpeg')" class="w-full px-4 py-3 bg-black/40 text-gray-300 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 hover:text-text-main border border-black/5 dark:border-white/5 transition-all text-xs font-bold uppercase tracking-widest active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.refreshPackagesButton') }}</button>
            </div>
        </div>
      </Card>

      <Card :title="t('dashboard.airplayCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">cast</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.receiverLabel') }}</span>
                <span :class="systemStore.installedPackages['shairport-sync'] ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-sm font-black">
                    {{ systemStore.installedPackages['shairport-sync'] ? t('dashboard.enabledLabel') : t('dashboard.disabledLabel') }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages['shairport-sync']">
                 <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.statusLabel') }}</span>
                 <span :class="systemStore.shairportSyncStatus === 'active' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                     {{ systemStore.shairportSyncStatus }}
                 </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.packageVersions['shairport-sync']">
                  <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.versionLabel') }}</span>
                  <span class="text-sm font-bold text-gray-200">
                      {{ systemStore.packageVersions['shairport-sync'] }}
                  </span>
             </div>
            <div class="pt-4 flex flex-col space-y-3 border-t border-black/5 dark:border-white/5" v-if="systemStore.installedPackages['shairport-sync']">
                <div class="grid grid-cols-2 gap-3">
                    <button @click="systemStore.controlService('restart', 'shairport-sync')" class="px-3 py-2.5 bg-black/40 hover:bg-black/10 dark:hover:bg-white/10 text-text-main border border-black/5 dark:border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.restartButton') }}</button>
                    <button v-if="systemStore.shairportSyncStatus === 'active'" @click="systemStore.controlService('stop', 'shairport-sync')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.stopButton') }}</button>
                    <button v-else @click="systemStore.controlService('start', 'shairport-sync')" class="px-3 py-2.5 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 border border-emerald-400/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.startButton') }}</button>
                </div>
                <button @click="handleUpdate('shairport-sync')" class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.updateShairportButton') }}
                </button>
                <button @click="handleUninstall('shairport-sync')" class="w-full px-4 py-3 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.uninstallAirplayButton') }}
                </button>
            </div>
            <div class="pt-4 border-t border-black/5 dark:border-white/5" v-else>
                 <button @click="systemStore.installPackage('shairport-sync')" class="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.installAirplayButton') }}
                 </button>
            </div>
        </div>
      </Card>

      <!-- MPD Card -->
      <Card :title="t('dashboard.mpdCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">queue_music</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.musicPlayerDaemonLabel') }}</span>
                <span :class="systemStore.installedPackages['mpd'] ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-sm font-black">
                    {{ systemStore.installedPackages['mpd'] ? t('dashboard.installedBadge') : t('dashboard.notInstalledBadge') }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages['mpd']">
                 <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.statusLabel') }}</span>
                 <span :class="systemStore.mpdStatus === 'active' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                     {{ systemStore.mpdStatus }}
                 </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.packageVersions['mpd']">
                  <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.versionLabel') }}</span>
                  <span class="text-sm font-bold text-gray-200">{{ systemStore.packageVersions['mpd'] }}</span>
            </div>
            <div class="pt-4 flex flex-col space-y-3 border-t border-black/5 dark:border-white/5" v-if="systemStore.installedPackages['mpd']">
                <div class="grid grid-cols-2 gap-3">
                    <button @click="systemStore.controlService('restart', 'mpd')" class="px-3 py-2.5 bg-black/40 hover:bg-black/10 dark:hover:bg-white/10 text-text-main border border-black/5 dark:border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.restartButton') }}</button>
                    <button v-if="systemStore.mpdStatus === 'active'" @click="systemStore.controlService('stop', 'mpd')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.stopButton') }}</button>
                    <button v-else @click="systemStore.controlService('start', 'mpd')" class="px-3 py-2.5 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 border border-emerald-400/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.startButton') }}</button>
                </div>
                <button @click="handleUpdate('mpd')" class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.updateMpdButton') }}
                </button>
                <button @click="handleUninstall('mpd')" class="w-full px-4 py-3 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.uninstallMpdButton') }}
                </button>
            </div>
            <div class="pt-4 border-t border-black/5 dark:border-white/5" v-else>
                 <button @click="systemStore.installPackage('mpd')" class="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.installMpdButton') }}
                 </button>
            </div>
        </div>
      </Card>

      <!-- myMPD Card -->
      <Card :title="t('dashboard.mympdCardTitle')">
        <template #icon>
            <span class="material-symbols-outlined">library_music</span>
        </template>
        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.webMusicClientLabel') }}</span>
                <span :class="systemStore.installedPackages['mympd'] ? 'text-emerald-400' : 'text-[#ff3b30]'" class="text-sm font-black">
                    {{ systemStore.installedPackages['mympd'] ? t('dashboard.installedBadge') : t('dashboard.notInstalledBadge') }}
                </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.installedPackages['mympd']">
                 <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.statusLabel') }}</span>
                 <span :class="systemStore.mympdStatus === 'active' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-[#ffcc00] bg-[#ffcc00]/10 border-[#ffcc00]/20'" class="px-2.5 py-1 rounded-lg text-[9px] border font-black uppercase tracking-widest">
                     {{ systemStore.mympdStatus }}
                 </span>
            </div>
            <div class="flex items-center justify-between" v-if="systemStore.packageVersions['mympd']">
                  <span class="text-sm font-semibold text-gray-400">{{ t('dashboard.versionLabel') }}</span>
                  <span class="text-sm font-bold text-gray-200">{{ systemStore.packageVersions['mympd'] }}</span>
            </div>
            <div class="pt-4 flex flex-col space-y-3 border-t border-black/5 dark:border-white/5" v-if="systemStore.installedPackages['mympd']">
                <button v-if="systemStore.mympdRunning" @click="openMympd" class="w-full px-4 py-3 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 border border-emerald-400/20 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95">
                    <span class="material-symbols-outlined text-[1rem] mr-1 align-middle">open_in_new</span>{{ t('dashboard.openMympdButton') }}
                </button>
                <div class="grid grid-cols-2 gap-3">
                    <button @click="systemStore.controlService('restart', 'mympd')" class="px-3 py-2.5 bg-black/40 hover:bg-black/10 dark:hover:bg-white/10 text-text-main border border-black/5 dark:border-white/5 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.restartButton') }}</button>
                    <button v-if="systemStore.mympdStatus === 'active'" @click="systemStore.controlService('stop', 'mympd')" class="px-3 py-2.5 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.stopButton') }}</button>
                    <button v-else @click="systemStore.controlService('start', 'mympd')" class="px-3 py-2.5 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400 border border-emerald-400/20 rounded-xl transition-all text-xs font-bold active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">{{ t('dashboard.startButton') }}</button>
                </div>
                <button @click="handleUpdate('mympd')" class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.updateMympdButton') }}
                </button>
                <button @click="handleUninstall('mympd')" class="w-full px-4 py-3 bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30] border border-[#ff3b30]/20 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.uninstallMympdButton') }}
                </button>
            </div>
            <div class="pt-4 border-t border-black/5 dark:border-white/5" v-else>
                 <button @click="systemStore.installPackage('mympd')" class="w-full px-6 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 shadow-xl shadow-brand-primary/30 transition-all active:scale-95 disabled:opacity-50" :disabled="systemStore.loading">
                    {{ t('dashboard.installMympdButton') }}
                 </button>
            </div>
        </div>
      </Card>

      </div>

      <!-- ── Destructive-action confirmations (Task 31) ─────────────────── -->
      <ConfirmDestructive
        v-model="showConfirmReinstall"
        :title="t('dashboard.cleanReinstallLabel')"
        :message="t('dashboard.reinstallConfirmMessage', { pkg: pendingReinstallPkg ?? '' })"
        :entity-name="pendingReinstallPkg ?? ''"
        :confirm-label="t('dashboard.reinstallConfirmLabel')"
        @confirm="performUpdate(pendingReinstallPkg!, true)"
      />

      <ConfirmDestructive
        v-model="showConfirmUninstall"
        :title="t('dashboard.uninstallLabel')"
        :message="t('dashboard.uninstallConfirmMessage', { pkg: pendingUninstallPkg ?? '' })"
        :entity-name="pendingUninstallPkg ?? ''"
        :confirm-label="t('dashboard.uninstallLabel')"
        @confirm="performUninstall"
      />

      <ConfirmDialog
        v-model="showConfirmUpdateNode"
        :title="t('dashboard.updateNodeDialogTitle')"
        :message="t('dashboard.updateNodeConfirmMessage', { version: selectedNodeVersion })"
        :confirm-text="t('dashboard.updateConfirmLabel')"
        @confirm="handleUpdateNodeJs"
      />
  </div>
</Layout>
</template>
