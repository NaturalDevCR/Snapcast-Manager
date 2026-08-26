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

  it('fetchDiagnostics() leaves findings at their last-known value and logs on failure', async () => {
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
    expect(consoleSpy).toHaveBeenCalled();
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
