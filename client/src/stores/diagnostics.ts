// Task 63 (Stage 5, item 5.5, part 2/2 -- frontend half): Pinia store
// wrapping the authenticated GET /api/diagnostics endpoint (Task 62).
// Follows stores/health.ts's established shape: a `loading` ref plus a
// fetch function that calls fetchApi() and swallows/logs errors rather than
// throwing, so a transient failure just leaves `findings` at its
// last-known value instead of crashing the caller.
//
// `DiagnosticFinding`/`DiagnosticRepairAction` are typed directly against
// the real response shape shipped in server/src/services/diagnostics.ts --
// read that file, don't guess at it.
//
// Repair application (`applyRepair`) is a second, separate function: it
// only fires the `fetchApi` POST call for a `kind: 'endpoint'` repair
// action and returns/throws -- it does NOT show toasts or re-fetch itself.
// That's deliberately left to the calling component (Diagnostics.vue),
// matching this codebase's existing separation of concerns: stores fetch
// data, components own UI feedback (see PipeSources.vue's control()/
// handleDelete() for the established pattern this mirrors).
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export type DiagnosticCategory =
  | 'unmanaged-config'
  | 'orphaned-unit'
  | 'fifo-no-producer'
  | 'snapserver-down'
  | 'port-occupied';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface DiagnosticRepairAction {
  label: string;
  kind: 'endpoint' | 'manual';
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint?: string;
  body?: Record<string, unknown>;
  instructions?: string;
}

export interface DiagnosticFinding {
  id: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  message: string;
  repairAction?: DiagnosticRepairAction;
}

// fetchApi() already prepends `/api` to whatever endpoint string it's
// given (see utils/api.ts) -- every OTHER call site in this codebase passes
// a bare `/foo` path for exactly that reason (see stores/system.ts,
// PipeSources.vue's restartSnapserver(), etc.). The server's
// DiagnosticRepairAction.endpoint values are full paths INCLUDING the
// `/api` prefix (e.g. "/api/system/service/restart/snapserver") since
// they're meant to be directly recognizable REST endpoints on their own --
// strip that prefix here before handing the path to fetchApi(), so the
// actual request doesn't end up double-prefixed as `/api/api/...`.
function stripApiPrefix(endpoint: string): string {
  return endpoint.startsWith('/api') ? endpoint.slice(4) : endpoint;
}

export const useDiagnosticsStore = defineStore('diagnostics', () => {
  const loading = ref(false);
  const findings = ref<DiagnosticFinding[]>([]);

  async function fetchDiagnostics() {
    loading.value = true;
    try {
      const data = await fetchApi<{ findings: DiagnosticFinding[] }>('/diagnostics');
      findings.value = data.findings ?? [];
    } catch (err) {
      console.error('Failed to fetch diagnostics:', err);
    } finally {
      loading.value = false;
    }
  }

  async function applyRepair(repairAction: DiagnosticRepairAction): Promise<void> {
    if (repairAction.kind !== 'endpoint' || !repairAction.endpoint) {
      throw new Error('This finding has no automated repair action.');
    }
    await fetchApi(stripApiPrefix(repairAction.endpoint), {
      method: repairAction.method ?? 'POST',
      ...(repairAction.body !== undefined ? { body: JSON.stringify(repairAction.body) } : {}),
    });
  }

  return {
    loading,
    findings,
    fetchDiagnostics,
    applyRepair,
  };
});
