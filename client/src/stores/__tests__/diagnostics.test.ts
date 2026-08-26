import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDiagnosticsStore } from '../diagnostics';
import * as api from '../../utils/api';

describe('useDiagnosticsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('starts with an empty findings array', () => {
    const store = useDiagnosticsStore();
    expect(store.findings).toEqual([]);
    expect(store.loading).toBe(false);
    expect(store.error).toBe(null);
  });

  it('fetchDiagnostics() populates findings from GET /diagnostics on success', async () => {
    const findings = [
      {
        id: 'snapserver-down',
        category: 'snapserver-down' as const,
        severity: 'error' as const,
        message: 'Snapserver appears to be down.',
        repairAction: {
          label: 'Restart snapserver',
          kind: 'endpoint' as const,
          method: 'POST' as const,
          endpoint: '/api/system/service/restart/snapserver',
        },
      },
    ];
    vi.spyOn(api, 'fetchApi').mockResolvedValue({ findings });

    const store = useDiagnosticsStore();
    await store.fetchDiagnostics();

    expect(api.fetchApi).toHaveBeenCalledWith('/diagnostics');
    expect(store.findings).toEqual(findings);
    expect(store.loading).toBe(false);
  });

  it('fetchDiagnostics() leaves findings at their last-known value, logs, and sets `error` on failure', async () => {
    // A failed fetch MUST be distinguishable from "confirmed 0 findings" --
    // an admin diagnostics tool going quiet on a network/auth error and
    // looking identical to a genuinely healthy system is a real safety gap
    // (caught in Task 63's review). `error` is what Diagnostics.vue/
    // Dashboard.vue key off of to render a distinct "couldn't check" state
    // instead of silently reusing the all-clear one.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(api, 'fetchApi').mockRejectedValue(new Error('network down'));

    const store = useDiagnosticsStore();
    store.findings = [
      {
        id: 'x',
        category: 'port-occupied',
        severity: 'warning',
        message: 'stale',
      },
    ];
    await store.fetchDiagnostics();

    expect(store.findings).toEqual([
      { id: 'x', category: 'port-occupied', severity: 'warning', message: 'stale' },
    ]);
    expect(store.loading).toBe(false);
    expect(store.error).toBe('network down');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('fetchDiagnostics() clears a stale `error` on a subsequent successful fetch', async () => {
    const store = useDiagnosticsStore();
    const spy = vi.spyOn(api, 'fetchApi').mockRejectedValueOnce(new Error('network down'));
    await store.fetchDiagnostics();
    expect(store.error).toBe('network down');

    spy.mockResolvedValueOnce({ findings: [] });
    await store.fetchDiagnostics();
    expect(store.error).toBe(null);
  });

  it('applyRepair() calls fetchApi with the repair action\'s method/endpoint (stripping the /api prefix) and JSON body when present', async () => {
    vi.spyOn(api, 'fetchApi').mockResolvedValue({});
    const store = useDiagnosticsStore();

    await store.applyRepair({
      label: 'Start this pipe source',
      kind: 'endpoint',
      method: 'POST',
      endpoint: '/api/pipe-sources/p1/control',
      body: { action: 'start' },
    });

    expect(api.fetchApi).toHaveBeenCalledWith('/pipe-sources/p1/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
    });
  });

  it('applyRepair() omits the body option entirely when the repair action has no body', async () => {
    vi.spyOn(api, 'fetchApi').mockResolvedValue({});
    const store = useDiagnosticsStore();

    await store.applyRepair({
      label: 'Restart snapserver',
      kind: 'endpoint',
      method: 'POST',
      endpoint: '/api/system/service/restart/snapserver',
    });

    expect(api.fetchApi).toHaveBeenCalledWith('/system/service/restart/snapserver', {
      method: 'POST',
    });
  });

  it('applyRepair() throws for a non-endpoint repair action instead of calling fetchApi', async () => {
    const spy = vi.spyOn(api, 'fetchApi');
    const store = useDiagnosticsStore();

    await expect(
      store.applyRepair({ label: 'Review and remove manually', kind: 'manual', instructions: 'do it by hand' }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('applyRepair() propagates the error thrown by fetchApi so the caller can show a failure toast', async () => {
    vi.spyOn(api, 'fetchApi').mockRejectedValue(new Error('boom'));
    const store = useDiagnosticsStore();

    await expect(
      store.applyRepair({
        label: 'Restart snapserver',
        kind: 'endpoint',
        method: 'POST',
        endpoint: '/api/system/service/restart/snapserver',
      }),
    ).rejects.toThrow('boom');
  });
});
