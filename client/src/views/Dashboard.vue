<script setup lang="ts">
// Dashboard.vue -- UI overhaul (2026-11).
//
// Reorganized around the questions an admin opens this page with, in order:
//   1. "Is it working?"  -- a row of status tiles (snapserver, streams,
//      clients, diagnostics), each linking to the page that explains it.
//   2. "What's playing / who's connected?" -- streams + clients lists, next
//      to the detailed health checks.
//   3. "Manage the software" -- one ServiceCard per package.
//   4. "This manager" -- version + Node.js runtime, demoted to the bottom.
//
// Removed: the "Core Engine" card, whose "System Normal / Operational /
// Health 100%" was hardcoded and shown even while snapserver was down; the
// "Management Core" card's hardcoded "Everything is synced" message and
// permanently-disabled "UI up to date" button.
import { computed, onMounted, ref, watch } from 'vue';
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
import SnapcastChannelPicker from '../components/SnapcastChannelPicker.vue';
import Badge from '../components/ui/Badge.vue';
import Button from '../components/ui/Button.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import SectionHeader from '../components/ui/SectionHeader.vue';
import ConfirmDestructive from '../components/ui/ConfirmDestructive.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import JobLogPanel from '../components/JobLogPanel.vue';
import StatTile, { type StatTone } from '../components/dashboard/StatTile.vue';
import ServiceCard from '../components/dashboard/ServiceCard.vue';
import { version } from '../../package.json';

const { t } = useI18n({ useScope: 'global' });
const systemStore = useSystemStore();
const uiStore = useUIStore();
const snapcastStore = useSnapcastStore();
const onboardingStore = useOnboardingStore();
const healthStore = useHealthStore();
const diagnosticsStore = useDiagnosticsStore();

// Task 29: snapcast state arrives via the app-wide SSE connection (Task 28)
// rather than this view polling; the badge in the header surfaces that
// connection's own status.
const sse = useEventSource();
const liveBadge = computed(() => sseStatusBadge(sse.status.value));

const selectedNodeVersion = ref('22');

onMounted(async () => {
  // Fire the independent fetches together instead of awaiting the (slow)
  // package scan before anything else starts.
  snapcastStore.fetchStatus();
  healthStore.fetchHealthDetail();
  diagnosticsStore.fetchDiagnostics();
  onboardingStore.fetchOnboarding();
  systemStore.fetchMympdInfo();
  await systemStore.refreshAll();

  const match = systemStore.packageVersions.node?.match(/v?(\d+)/);
  if (match?.[1]) selectedNodeVersion.value = match[1];
});

// The health panel used to be fetched once on mount, so its "RPC
// disconnected" could sit next to live stream data for as long as the page
// stayed open. Re-check whenever SSE reports snapserver coming or going.
const rpcLive = computed(() => !!snapcastStore.status);
watch(rpcLive, () => healthStore.fetchHealthDetail());

const handleHealthRefresh = () => {
  healthStore.fetchHealthDetail();
};

const refreshEverything = () => {
  systemStore.refreshAll();
  healthStore.fetchHealthDetail();
  diagnosticsStore.fetchDiagnostics();
  snapcastStore.fetchStatus();
};

// ── Status tiles ────────────────────────────────────────────────────────
const snapserverTile = computed<{ value: string; tone: StatTone }>(() => {
  const systemdActive = healthStore.detail?.snapserver?.systemdActive ?? systemStore.snapserverStatus === 'active';
  if (rpcLive.value) return { value: t('dashboard.snapserverStateRunning'), tone: 'success' };
  if (systemdActive) return { value: t('dashboard.snapserverStateNotResponding'), tone: 'warning' };
  if (!healthStore.detail && systemStore.loading) return { value: t('dashboard.snapserverStateChecking'), tone: 'neutral' };
  if (!systemStore.installedPackages.snapserver) return { value: t('dashboard.snapserverStateNotInstalled'), tone: 'neutral' };
  return { value: t('dashboard.snapserverStateOffline'), tone: 'danger' };
});

const snapserverVersion = computed(() => {
  const v = systemStore.packageVersions.snapserver;
  if (v && v !== 'unknown') return v;
  // Server.GetStatus reports it as server.snapserver.version (the store's
  // SnapcastStatus type predates that field).
  const server = snapcastStore.status?.server as { snapserver?: { version?: string } } | undefined;
  return server?.snapserver?.version;
});

const streams = computed(() => snapcastStore.status?.streams ?? []);
const playingCount = computed(() => streams.value.filter((s) => s.status === 'playing').length);

const allClients = computed(() =>
  (snapcastStore.status?.groups ?? [])
    .flatMap((g) => g.clients)
    .slice()
    .sort((a, b) => Number(b.connected) - Number(a.connected)),
);
const onlineCount = computed(() => allClients.value.filter((c) => c.connected).length);

const diagnosticsTile = computed<{ value: string; tone: StatTone; to?: string }>(() => {
  if (diagnosticsStore.error) return { value: t('dashboard.diagnosticsUnknown'), tone: 'neutral', to: '/diagnostics' };
  const count = diagnosticsStore.findings.length;
  if (count > 0) {
    const hasError = diagnosticsStore.findings.some((f) => f.severity === 'error');
    return { value: t('dashboard.diagnosticsIssuesFound', { count }), tone: hasError ? 'danger' : 'warning', to: '/diagnostics' };
  }
  return { value: t('dashboard.diagnosticsAllClear'), tone: 'success' };
});

// ── Health panel ────────────────────────────────────────────────────────
// disk.freePercent is only present on the success branch of the backend's
// discriminated union (disk.error on the failure branch).
const diskFreePercent = computed(() => {
  const disk = healthStore.detail?.disk;
  return disk && 'freePercent' in disk ? disk.freePercent : null;
});

const healthRows = computed(() => {
  const d = healthStore.detail;
  if (!d) return [];
  return [
    {
      key: 'systemd',
      label: t('dashboard.healthSystemdLabel'),
      ok: d.snapserver?.systemdActive,
      value: d.snapserver?.systemdActive ? t('dashboard.healthActiveStatus') : t('dashboard.healthInactiveStatus'),
    },
    {
      key: 'rpc',
      label: t('dashboard.healthRpcLabel'),
      ok: d.snapserver?.rpcConnected,
      value: d.snapserver?.rpcConnected ? t('dashboard.healthConnectedStatus') : t('dashboard.healthDisconnectedStatus'),
    },
    {
      key: 'config',
      label: t('dashboard.healthConfigLabel'),
      ok: d.config?.parseable,
      value: d.config?.parseable ? t('dashboard.healthConfigParseableStatus') : t('dashboard.healthConfigErrorStatus'),
      detail: d.config && !d.config.parseable ? d.config.error : undefined,
    },
    {
      key: 'disk',
      label: t('dashboard.healthDiskLabel'),
      ok: diskFreePercent.value === null ? undefined : diskFreePercent.value >= 10,
      value:
        diskFreePercent.value !== null
          ? t('dashboard.healthDiskFreeValue', { percent: diskFreePercent.value })
          : t('dashboard.healthDiskUnknownStatus'),
    },
    {
      key: 'permissions',
      label: t('dashboard.healthPermissionsLabel'),
      ok: d.permissions?.snapshotsDirWritable,
      value: d.permissions?.snapshotsDirWritable ? t('dashboard.healthWritableYes') : t('dashboard.healthWritableNo'),
    },
  ];
});

// ── Package actions ─────────────────────────────────────────────────────
type UpdatablePackage = 'snapserver' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'mpd' | 'mympd';
type UninstallablePackage = 'shairport-sync' | 'mpd' | 'mympd';
type ServicePackage = 'snapserver' | 'shairport-sync' | 'mpd' | 'mympd';

// Clean reinstall (destructive: deletes config first)
const showConfirmReinstall = ref(false);
const pendingReinstallPkg = ref<UpdatablePackage | null>(null);

const askReinstall = (pkg: UpdatablePackage) => {
  pendingReinstallPkg.value = pkg;
  showConfirmReinstall.value = true;
};

const performUpdate = async (pkg: UpdatablePackage, clean: boolean) => {
  try {
    await systemStore.updatePackage(pkg, clean);
    uiStore.showToast(
      clean ? t('dashboard.packageReinstalledSuccess', { pkg }) : t('dashboard.packageUpdatedSuccess', { pkg }),
      'success',
    );
  } catch (err: any) {
    uiStore.showToast(
      (clean ? t('dashboard.packageReinstallFailed', { pkg }) : t('dashboard.packageUpdateFailed', { pkg })) + err.message,
      'error',
    );
  }
};

// Uninstall (destructive: removes binaries and service files)
const showConfirmUninstall = ref(false);
const pendingUninstallPkg = ref<UninstallablePackage | null>(null);

const askUninstall = (pkg: UninstallablePackage) => {
  pendingUninstallPkg.value = pkg;
  showConfirmUninstall.value = true;
};

const performUninstall = async () => {
  const pkg = pendingUninstallPkg.value;
  if (!pkg) return;
  try {
    await systemStore.uninstallPackage(pkg);
    uiStore.showToast(t('dashboard.packageUninstalledSuccess', { pkg }), 'success');
    await systemStore.refreshAll();
  } catch (err: any) {
    uiStore.showToast(t('dashboard.packageUninstallFailed', { pkg }) + err.message, 'error');
  } finally {
    pendingUninstallPkg.value = null;
  }
};

const control = (service: ServicePackage, action: 'start' | 'stop' | 'restart') =>
  systemStore.controlService(action, service);

// Update Node.js (disruptive, NOT data-destructive)
const showConfirmUpdateNode = ref(false);

const handleUpdateNodeJs = async () => {
  try {
    await systemStore.updateNodeJs(selectedNodeVersion.value);
    uiStore.showToast(t('dashboard.nodeUpdateInitiatedSuccess', { version: selectedNodeVersion.value }), 'success');
  } catch (err: any) {
    uiStore.showToast(t('dashboard.nodeUpdateFailed') + err.message, 'error');
  }
};

const nodeMajor = computed(() => systemStore.packageVersions.node?.match(/v?(\d+)/)?.[1] ?? null);

const openMympd = () => {
  window.open(systemStore.mympdUrl, '_blank', 'noopener');
};

const isServerMode = computed(() => systemStore.snapcastMode !== 'client');
</script>

<template>
  <Layout>
    <PageHeader :title="t('dashboard.headerTitle')" :description="t('dashboard.headerSubtitle')">
      <template #badge>
        <Badge :variant="liveBadge.variant" size="sm">{{ liveBadge.label }}</Badge>
      </template>
      <template #actions>
        <Button variant="subtle" :loading="systemStore.loading" @click="refreshEverything">
          <span v-if="!systemStore.loading" class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">refresh</span>
          {{ t('dashboard.refreshButton') }}
        </Button>
      </template>
    </PageHeader>

    <div class="space-y-8">
      <!-- Resume-onboarding banner (Task 50) -->
      <div
        v-if="onboardingStore.step < 3 && !onboardingStore.dismissed"
        class="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-brand-primary/30 bg-brand-primary/10 p-4 sm:p-5"
      >
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <span class="material-symbols-outlined text-brand-primary-text" aria-hidden="true">rocket_launch</span>
          <div>
            <p class="text-sm font-semibold text-text-main">{{ t('dashboard.resumeBannerTitle') }}</p>
            <p class="text-sm text-text-muted mt-0.5">{{ t('dashboard.resumeBannerText') }}</p>
          </div>
        </div>
        <router-link
          to="/onboarding"
          class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/85 transition-colors flex-shrink-0"
        >
          {{ t('dashboard.resumeBannerLink') }}
          <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">arrow_forward</span>
        </router-link>
      </div>

      <!-- 1. At a glance -->
      <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatTile
          v-if="isServerMode"
          :label="t('dashboard.statSnapserver')"
          icon="dns"
          :value="snapserverTile.value"
          :tone="snapserverTile.tone"
          :detail="snapserverVersion ? `v${snapserverVersion.replace(/^v/, '')}` : undefined"
          to="/server"
        />
        <StatTile
          v-if="isServerMode"
          :label="t('dashboard.statStreams')"
          icon="graphic_eq"
          :value="t('dashboard.streamsPlaying', { playing: playingCount })"
          :tone="playingCount > 0 ? 'success' : 'neutral'"
          :detail="t('dashboard.outOfTotal', { total: streams.length })"
          to="/pipe-sources"
        />
        <StatTile
          v-if="isServerMode"
          :label="t('dashboard.statClients')"
          icon="speaker_group"
          :value="t('dashboard.clientsOnline', { online: onlineCount })"
          :tone="!rpcLive ? 'neutral' : onlineCount > 0 ? 'success' : 'warning'"
          :detail="t('dashboard.outOfTotal', { total: allClients.length })"
          to="/routing"
        />
        <StatTile
          :label="t('dashboard.statDiagnostics')"
          icon="health_and_safety"
          :value="diagnosticsTile.value"
          :tone="diagnosticsTile.tone"
          :detail="diagnosticsTile.to ? t('dashboard.diagnosticsReview') : undefined"
          :to="diagnosticsTile.to"
        />
      </section>

      <!-- Loading overlay + full job log window -->
      <JobLogPanel />

      <!-- 2. Live: streams, clients, health -->
      <section class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <template v-if="isServerMode">
          <template v-if="snapcastStore.status">
            <Card :title="t('dashboard.streamsCardTitle')">
              <template #icon><span class="material-symbols-outlined text-[1.2rem]">graphic_eq</span></template>
              <ul v-if="streams.length" class="-my-1 divide-y divide-line">
                <li v-for="stream in streams" :key="stream.id" class="flex items-center justify-between gap-3 py-2.5">
                  <span class="flex items-center gap-2.5 min-w-0">
                    <span
                      class="w-2 h-2 rounded-full flex-shrink-0"
                      :class="stream.status === 'playing' ? 'bg-success' : 'bg-text-muted/40'"
                      aria-hidden="true"
                    ></span>
                    <span class="text-sm text-text-main truncate" :title="stream.id">{{ stream.uri?.query?.name || stream.id }}</span>
                  </span>
                  <Badge :variant="stream.status === 'playing' ? 'success' : 'neutral'" size="sm">
                    {{ stream.status === 'playing' ? t('dashboard.streamPlaying') : t('dashboard.streamIdle') }}
                  </Badge>
                </li>
              </ul>
              <div v-else class="flex flex-col items-start gap-2 text-sm text-text-muted">
                {{ t('dashboard.streamsEmpty') }}
                <router-link to="/pipe-sources" class="font-semibold text-brand-primary-text hover:underline">{{ t('dashboard.addSourceLink') }}</router-link>
              </div>
            </Card>

            <Card :title="t('dashboard.clientsCardTitle')">
              <template #icon><span class="material-symbols-outlined text-[1.2rem]">speaker_group</span></template>
              <template #action>
                <router-link to="/routing" class="text-xs font-semibold text-brand-primary-text hover:underline">{{ t('dashboard.openMatrixLink') }}</router-link>
              </template>
              <ul v-if="allClients.length" class="-my-1 divide-y divide-line">
                <li
                  v-for="client in allClients"
                  :key="client.id"
                  class="flex items-center justify-between gap-3 py-2.5"
                  :class="client.connected ? '' : 'opacity-60'"
                >
                  <div class="min-w-0">
                    <p class="text-sm text-text-main truncate">{{ client.config.name || client.host.name }}</p>
                    <p class="text-[11px] text-text-muted font-mono">{{ client.host.ip }}</p>
                  </div>
                  <span v-if="!client.connected" class="text-xs text-text-muted">{{ t('dashboard.clientOffline') }}</span>
                  <span v-else-if="client.config.volume.muted" class="inline-flex items-center gap-1 text-xs text-text-muted">
                    <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">volume_off</span>
                    {{ t('dashboard.volumeMutedLabel') }}
                  </span>
                  <span v-else class="flex items-center gap-2">
                    <span class="h-1.5 w-16 rounded-full bg-line overflow-hidden" aria-hidden="true">
                      <span class="block h-full bg-brand-primary" :style="{ width: client.config.volume.percent + '%' }"></span>
                    </span>
                    <span class="text-xs tabular-nums text-text-muted w-9 text-right">{{ client.config.volume.percent }}%</span>
                  </span>
                </li>
              </ul>
              <p v-else class="text-sm text-text-muted">{{ t('dashboard.clientsEmpty') }}</p>
            </Card>
          </template>

          <!-- Snapserver unreachable -->
          <div
            v-else-if="!snapcastStore.loading"
            class="lg:col-span-2 flex flex-col items-center justify-center text-center gap-2 rounded-2xl border border-dashed border-line bg-brand-surface/50 p-8"
          >
            <span class="material-symbols-outlined text-3xl text-text-muted" aria-hidden="true">cloud_off</span>
            <h3 class="text-sm font-semibold text-text-main">{{ t('dashboard.snapserverOfflineTitle') }}</h3>
            <p class="text-sm text-text-muted max-w-md">{{ t('dashboard.snapserverOfflineHint') }}</p>
            <p v-if="snapcastStore.error" class="text-xs font-mono text-text-muted/80 max-w-md break-words">{{ snapcastStore.error }}</p>
          </div>
        </template>

        <Card :title="t('dashboard.healthPanelTitle')">
          <template #icon><span class="material-symbols-outlined text-[1.2rem]">monitor_heart</span></template>
          <template #action>
            <button
              type="button"
              :disabled="healthStore.loading"
              :aria-label="t('dashboard.healthRefreshAria')"
              class="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-main hover:bg-inset transition-colors disabled:opacity-50"
              @click="handleHealthRefresh"
            >
              <span class="material-symbols-outlined text-[1.1rem]" :class="{ 'animate-spin': healthStore.loading }">refresh</span>
            </button>
          </template>
          <dl v-if="healthRows.length" class="-my-1 divide-y divide-line">
            <div v-for="row in healthRows" :key="row.key" class="py-2.5">
              <div class="flex items-center justify-between gap-3">
                <dt class="text-sm text-text-muted">{{ row.label }}</dt>
                <dd
                  class="flex items-center gap-1.5 text-sm font-medium whitespace-nowrap"
                  :class="row.ok === undefined ? 'text-text-muted' : row.ok ? 'text-text-main' : 'text-danger'"
                >
                  <span
                    class="material-symbols-outlined text-[1rem]"
                    :class="row.ok === undefined ? 'text-text-muted' : row.ok ? 'text-success' : 'text-danger'"
                    aria-hidden="true"
                  >{{ row.ok === undefined ? 'help' : row.ok ? 'check_circle' : 'error' }}</span>
                  {{ row.value }}
                </dd>
              </div>
              <p v-if="row.detail" class="mt-1 text-xs font-mono text-danger/90 break-words">{{ row.detail }}</p>
            </div>
          </dl>
          <div v-else class="space-y-3" aria-hidden="true">
            <div v-for="n in 5" :key="n" class="h-4 rounded bg-inset animate-pulse"></div>
          </div>
        </Card>
      </section>

      <!-- 3. Services -->
      <section class="space-y-4">
        <SectionHeader :title="t('dashboard.servicesHeading')" :description="t('dashboard.servicesDescription')" />
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <ServiceCard
            v-if="isServerMode"
            :name="t('dashboard.snapserverCardTitle')"
            icon="dns"
            :description="t('dashboard.snapserverDescription')"
            :installed="systemStore.installedPackages.snapserver"
            :service-status="systemStore.snapserverStatus"
            :version="systemStore.packageVersions.snapserver"
            :available-version="systemStore.availableVersions.snapserver"
            :busy="systemStore.loading"
            can-reinstall
            @install="systemStore.installPackage('snapserver')"
            @update="performUpdate('snapserver', false)"
            @reinstall="askReinstall('snapserver')"
            @control="(a) => control('snapserver', a)"
          >
            <details class="group rounded-xl border border-line bg-inset">
              <summary class="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-text-muted hover:text-text-main">
                {{ t('dashboard.releaseChannelLabel') }}
                <span class="material-symbols-outlined text-[1rem] transition-transform group-open:rotate-180" aria-hidden="true">expand_more</span>
              </summary>
              <div class="px-3 pb-3">
                <SnapcastChannelPicker pkg="snapserver" />
              </div>
            </details>
          </ServiceCard>

          <ServiceCard
            :name="t('dashboard.airplayCardTitle')"
            icon="cast"
            :description="t('dashboard.airplayDescription')"
            :installed="systemStore.installedPackages['shairport-sync']"
            :service-status="systemStore.shairportSyncStatus"
            :version="systemStore.packageVersions['shairport-sync']"
            :available-version="systemStore.availableVersions['shairport-sync']"
            :busy="systemStore.loading"
            can-uninstall
            @install="systemStore.installPackage('shairport-sync')"
            @update="performUpdate('shairport-sync', false)"
            @uninstall="askUninstall('shairport-sync')"
            @control="(a) => control('shairport-sync', a)"
          />

          <ServiceCard
            :name="t('dashboard.mpdCardTitle')"
            icon="queue_music"
            :description="t('dashboard.mpdDescription')"
            :installed="systemStore.installedPackages.mpd"
            :service-status="systemStore.mpdStatus"
            :version="systemStore.packageVersions.mpd"
            :available-version="systemStore.availableVersions.mpd"
            :busy="systemStore.loading"
            can-uninstall
            @install="systemStore.installPackage('mpd')"
            @update="performUpdate('mpd', false)"
            @uninstall="askUninstall('mpd')"
            @control="(a) => control('mpd', a)"
          />

          <ServiceCard
            :name="t('dashboard.mympdCardTitle')"
            icon="library_music"
            :description="t('dashboard.mympdDescription', { port: systemStore.mympdPort })"
            :installed="systemStore.installedPackages.mympd"
            :service-status="systemStore.mympdStatus"
            :version="systemStore.packageVersions.mympd"
            :available-version="systemStore.availableVersions.mympd"
            :busy="systemStore.loading"
            can-uninstall
            @install="systemStore.installPackage('mympd')"
            @update="performUpdate('mympd', false)"
            @uninstall="askUninstall('mympd')"
            @control="(a) => control('mympd', a)"
          >
            <template v-if="systemStore.installedPackages.mympd && systemStore.mympdRunning" #actions>
              <Button size="sm" variant="secondary" @click="openMympd">
                <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">open_in_new</span>
                {{ t('dashboard.openMympdButton') }}
              </Button>
            </template>
          </ServiceCard>

          <ServiceCard
            :name="t('dashboard.ffmpegCardTitle')"
            icon="movie"
            :description="t('dashboard.ffmpegDescription')"
            :installed="systemStore.installedPackages.ffmpeg"
            :version="systemStore.packageVersions.ffmpeg"
            :available-version="systemStore.availableVersions.ffmpeg"
            :busy="systemStore.loading"
            @install="systemStore.installPackage('ffmpeg')"
            @update="performUpdate('ffmpeg', false)"
          />

          <ServiceCard
            v-if="isServerMode"
            :name="t('dashboard.snapCtrlCardTitle')"
            icon="settings_remote"
            :description="t('dashboard.snapCtrlDescription')"
            :installed="systemStore.installedPackages['snap-ctrl']"
            :version="systemStore.packageVersions['snap-ctrl']"
            :available-version="systemStore.availableVersions['snap-ctrl']"
            :busy="systemStore.loading"
            @install="performUpdate('snap-ctrl', false)"
            @update="performUpdate('snap-ctrl', false)"
          />
        </div>
      </section>

      <!-- 4. This manager -->
      <section class="space-y-4">
        <SectionHeader :title="t('dashboard.systemHeading')" :description="t('dashboard.systemDescription')" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="rounded-2xl border border-line bg-brand-surface/80 p-5 shadow-sm flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <img src="../assets/logo.png" alt="" class="w-10 h-10 rounded-xl object-cover" />
              <div>
                <h3 class="text-sm font-bold text-text-main">{{ t('dashboard.managerCardTitle') }}</h3>
                <p class="text-xs text-text-muted">
                  {{ t('dashboard.appVersionLabel') }}: <span class="font-mono text-text-main">v{{ version }}</span>
                </p>
              </div>
            </div>
            <a
              href="https://github.com/NaturalDevCR/Snapcast-Manager/releases"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-primary-text hover:underline"
            >
              {{ t('dashboard.releaseNotesLink') }}
              <span class="material-symbols-outlined text-[0.95rem]" aria-hidden="true">open_in_new</span>
            </a>
          </div>

          <div class="rounded-2xl border border-line bg-brand-surface/80 p-5 shadow-sm flex flex-col gap-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-sm font-bold text-text-main">{{ t('dashboard.runtimeCardTitle') }}</h3>
                <p class="text-xs text-text-muted">
                  {{ t('dashboard.nodeCurrentLabel') }}:
                  <span class="font-mono text-text-main">{{ systemStore.packageVersions.node || t('dashboard.nodeUnknownLabel') }}</span>
                </p>
              </div>
              <span class="material-symbols-outlined text-text-muted" aria-hidden="true">javascript</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div class="flex rounded-lg border border-line bg-inset p-0.5" role="radiogroup" :aria-label="t('dashboard.selectLtsLabel')">
                <button
                  v-for="v in ['20', '22', '24']"
                  :key="v"
                  type="button"
                  role="radio"
                  :aria-checked="selectedNodeVersion === v"
                  :class="selectedNodeVersion === v ? 'bg-brand-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'"
                  class="rounded-md px-3 py-1 text-xs font-semibold transition-colors"
                  @click="selectedNodeVersion = v"
                >v{{ v }}</button>
              </div>
              <Button
                size="sm"
                variant="subtle"
                :disabled="systemStore.loading || selectedNodeVersion === nodeMajor"
                @click="showConfirmUpdateNode = true"
              >{{ t('dashboard.updateNodeButton', { version: selectedNodeVersion }) }}</Button>
            </div>
            <p class="text-xs text-text-muted">{{ t('dashboard.nodeHint') }}</p>
          </div>
        </div>
      </section>
    </div>

    <!-- Destructive-action confirmations (Task 31) -->
    <ConfirmDestructive
      v-model="showConfirmReinstall"
      :title="t('dashboard.reinstallButton')"
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
  </Layout>
</template>
