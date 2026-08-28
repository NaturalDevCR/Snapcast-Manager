<script setup lang="ts">
// Task 63 (Stage 5, item 5.5, part 2/2): self-diagnostics UI.
//
// Consumes GET /api/diagnostics (Task 62, server/src/services/diagnostics.ts)
// via stores/diagnostics.ts. Uses vue-i18n (the `diagnostics` namespace,
// useScope: 'global'), registered in both client/src/i18n.ts and
// client/src/test/mountView.ts.
//
// No polling -- manual refresh only, matching the Health panel's (Task 58)
// own explicit no-polling discipline.
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Layout from '../components/Layout.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Badge from '../components/ui/Badge.vue';
import { useDiagnosticsStore, type DiagnosticFinding, type DiagnosticCategory } from '../stores/diagnostics';
import { useUIStore } from '../stores/ui';

const store = useDiagnosticsStore();
const uiStore = useUIStore();
const { t } = useI18n({ useScope: 'global' });

onMounted(() => {
  store.fetchDiagnostics();
});

function handleRefresh() {
  store.fetchDiagnostics();
}

// Error first, then warning, then info -- per the task brief's suggested
// grouping. Findings within the same severity keep the order the server
// returned them in (Array#sort is stable).
const SEVERITY_ORDER: Record<DiagnosticFinding['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const sortedFindings = computed(() =>
  [...store.findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
);

// Reuses Badge.vue's existing variant palette rather than inventing new
// severity colors: `danger` (red) for error, `warning` (amber) -- the
// THIRD, already-established severity color in this codebase (see
// Badge.vue's own variantClasses -- amber/yellow is its real warning
// color, not the `#ffcc00` pending-state color Dashboard.vue uses for
// unrelated "update available" badges) -- and `neutral` for info (no
// finding-producing check currently emits 'info', but handled so this
// never crashes if that changes). Kept as a local literal union instead of
// importing BadgeProps from the .vue SFC, matching utils/sseStatus.ts's
// existing convention for coupling reasons.
type SeverityBadgeVariant = 'danger' | 'warning' | 'neutral';
const SEVERITY_BADGE_VARIANT: Record<DiagnosticFinding['severity'], SeverityBadgeVariant> = {
  error: 'danger',
  warning: 'warning',
  info: 'neutral',
};

const SEVERITY_ICON: Record<DiagnosticFinding['severity'], string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

// Human-readable display labels for the backend's DiagnosticCategory KEY
// strings (e.g. 'unmanaged-config'). The category keys themselves are
// API/contract values and must NOT be renamed or translated -- only these
// derived labels change with locale.
const CATEGORY_I18N_KEY: Record<DiagnosticCategory, string> = {
  'unmanaged-config': 'diagnostics.categoryUnmanagedConfig',
  'orphaned-unit': 'diagnostics.categoryOrphanedUnit',
  'fifo-no-producer': 'diagnostics.categoryFifoNoProducer',
  'snapserver-down': 'diagnostics.categorySnapserverDown',
  'port-occupied': 'diagnostics.categoryPortOccupied',
};

function categoryLabel(category: DiagnosticCategory): string {
  return CATEGORY_I18N_KEY[category] ? t(CATEGORY_I18N_KEY[category]) : category;
}

// ---- repair flow ----
const showConfirmRepair = ref(false);
const pendingFinding = ref<DiagnosticFinding | null>(null);
const applying = ref(false);

function openRepairConfirm(finding: DiagnosticFinding) {
  pendingFinding.value = finding;
  showConfirmRepair.value = true;
}

async function handleConfirmRepair() {
  // Re-entrance guard: ConfirmDialog emits `confirm` then closes itself
  // (`update:modelValue`, false) synchronously, while its leave transition
  // still animates for ~200ms -- a rapid double-click on the Confirm button
  // during that window could otherwise fire this twice. `applying` is also
  // bound in the template to disable both the Confirm button and the
  // triggering Repair button while a repair is in flight (see below) --
  // this check is the second, code-level half of that same protection, not
  // just cosmetic disabling.
  if (applying.value) return;

  const finding = pendingFinding.value;
  const repairAction = finding?.repairAction;
  if (!finding || !repairAction || repairAction.kind !== 'endpoint') return;

  applying.value = true;
  try {
    await store.applyRepair(repairAction);
    uiStore.showToast(t('diagnostics.repairSucceeded', { label: repairAction.label }), 'success');
    await store.fetchDiagnostics();
  } catch (err: any) {
    uiStore.showToast(err.message || t('diagnostics.repairFailed'), 'error');
  } finally {
    applying.value = false;
    pendingFinding.value = null;
  }
}
</script>

<template>
  <Layout>
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent">
            {{ t('diagnostics.title') }}
          </h1>
          <p class="text-zinc-400 mt-1 text-sm">
            {{ t('diagnostics.subtitle') }}
          </p>
        </div>
        <button
          @click="handleRefresh"
          :disabled="store.loading"
          :aria-label="t('diagnostics.refreshAriaLabel')"
          class="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-all active:scale-95 disabled:opacity-50"
        >
          <span class="material-symbols-outlined text-[1.1rem]" :class="{ 'animate-spin': store.loading }">refresh</span>
        </button>
      </div>

      <!-- Fetch failure: MUST be visually distinct from "confirmed healthy" --
           a diagnostics tool that goes quiet on a network/auth error and
           renders the same calm empty state as "genuinely 0 findings" is a
           real safety gap, not a UX nit (see Task 63 review). Checked before
           the empty-state branch so a failed fetch never falls through to
           looking like an all-clear result. -->
      <div
        v-if="!store.loading && store.error && sortedFindings.length === 0"
        class="border border-dashed border-red-800/40 rounded-lg"
      >
        <EmptyState
          icon="error"
          :title="t('diagnostics.runFailedTitle')"
          :description="t('diagnostics.runFailedDescription', { error: store.error ?? '' })"
        />
      </div>

      <!-- Empty state (calm, positive -- NOT an error style): confirmed
           empty (not still loading, not a failed fetch) is the only branch
           that renders this. -->
      <div
        v-else-if="!store.loading && sortedFindings.length === 0"
        class="border border-dashed border-emerald-800/40 rounded-lg"
      >
        <EmptyState
          icon="check_circle"
          :title="t('diagnostics.noIssuesTitle')"
          :description="t('diagnostics.noIssuesDescription')"
        />
      </div>

      <!-- Still loading, nothing to show yet -- distinct from confirmed-empty
           above, same discipline as PipeSources.vue's loading/EmptyState
           split. -->
      <div v-else-if="store.loading && sortedFindings.length === 0" class="flex items-center justify-center py-12 text-zinc-400 text-sm gap-2">
        <span class="material-symbols-outlined animate-spin text-[1rem]">sync</span>
        {{ t('diagnostics.running') }}
      </div>

      <!-- Findings list -->
      <div v-else class="space-y-3">
        <div
          v-for="finding in sortedFindings"
          :key="finding.id"
          class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start gap-3 sm:justify-between"
        >
          <div class="flex-1 min-w-0 space-y-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <Badge :variant="SEVERITY_BADGE_VARIANT[finding.severity]" size="sm">
                <span class="material-symbols-outlined text-[0.85rem] mr-1">{{ SEVERITY_ICON[finding.severity] }}</span>
                {{ finding.severity.toUpperCase() }}
              </Badge>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800 text-zinc-400">
                {{ categoryLabel(finding.category) }}
              </span>
            </div>
            <p class="text-sm text-zinc-300">{{ finding.message }}</p>
            <p v-if="finding.repairAction?.kind === 'manual'" class="text-xs text-zinc-400 italic mt-1">
              {{ finding.repairAction.instructions }}
            </p>
          </div>

          <div class="flex-shrink-0">
            <button
              v-if="finding.repairAction?.kind === 'endpoint'"
              @click="openRepairConfirm(finding)"
              :disabled="applying"
              class="px-3 py-1.5 rounded bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 text-xs font-medium transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span class="material-symbols-outlined text-[1rem]">build</span>
              {{ t('diagnostics.repair') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Repair confirmation -->
    <ConfirmDialog
      v-model="showConfirmRepair"
      :title="t('diagnostics.confirmRepairTitle', { label: pendingFinding?.repairAction?.label ?? '' })"
      :message="pendingFinding?.message ?? ''"
      :confirm-text="t('diagnostics.repair')"
      type="warning"
      @confirm="handleConfirmRepair"
    />
  </Layout>
</template>
