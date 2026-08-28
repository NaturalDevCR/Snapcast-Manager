import { describe, expect, it, vi } from 'vitest';
import { DOMWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import Diagnostics from '../Diagnostics.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useDiagnosticsStore, type DiagnosticFinding } from '../../stores/diagnostics';
import { useUIStore } from '../../stores/ui';

const endpointFinding: DiagnosticFinding = {
  id: 'fifo-no-producer-radio-gym',
  category: 'fifo-no-producer',
  severity: 'warning',
  message: 'FIFO for pipe source "Radio Gym" exists on disk, but its systemd unit is not active.',
  repairAction: {
    label: 'Start this pipe source',
    kind: 'endpoint',
    method: 'POST',
    endpoint: '/api/pipe-sources/p1/control',
    body: { action: 'start' },
  },
};

const manualFinding: DiagnosticFinding = {
  id: 'orphaned-unit-snapcast-radio-old',
  category: 'orphaned-unit',
  severity: 'warning',
  message: 'Systemd unit "snapcast-radio-old.service" exists but does not correspond to any tracked pipe source.',
  repairAction: {
    label: 'Review and remove manually',
    kind: 'manual',
    instructions: 'Stop/disable the unit and delete the file by hand.',
  },
};

describe('Diagnostics.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders a calm empty state when there are no findings', async () => {
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    const store = useDiagnosticsStore();
    store.findings = [];
    await nextTick();

    expect(wrapper.text()).toContain('No issues found');
  });

  it('renders Spanish copy when locale is switched to "es"', async () => {
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    const store = useDiagnosticsStore();
    store.findings = [];
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('No se encontraron problemas');
    expect(wrapper.text()).toContain('El autodiagnóstico de este sistema no encontró nada que corregir. Haz clic en actualizar para comprobar de nuevo.');
  });

  it('renders a distinct "couldn\'t check" state on a fetch failure, NOT the same empty state as confirmed-healthy', async () => {
    // Regression test for the Task 63 review finding: a failed fetch used to
    // be indistinguishable from "genuinely 0 findings" (both left `findings`
    // at [] and rendered the calm "No issues found" empty state). `error`
    // must now produce a visibly different message, and the reassuring
    // "No issues found" copy must NOT appear.
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    const store = useDiagnosticsStore();
    store.findings = [];
    store.error = 'network down';
    await nextTick();

    expect(wrapper.text()).not.toContain('No issues found');
    expect(wrapper.text()).toContain('network down');
  });

  it('renders a Repair button for an endpoint-kind finding, and no button for a manual-kind finding', async () => {
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    const store = useDiagnosticsStore();
    store.findings = [endpointFinding, manualFinding];
    await nextTick();

    expect(wrapper.text()).toContain(endpointFinding.message);
    expect(wrapper.text()).toContain(manualFinding.message);
    expect(wrapper.text()).toContain(manualFinding.repairAction!.instructions);

    const repairButtons = wrapper.findAll('button').filter((b) => b.text().includes('Repair'));
    expect(repairButtons.length).toBe(1);
  });

  describe('applying an endpoint repair (ConfirmDialog integration)', () => {
    async function setUpWithEndpointFinding() {
      const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
      const store = useDiagnosticsStore();
      store.findings = [endpointFinding];
      await nextTick();
      return wrapper;
    }

    function findRepairTrigger(wrapper: Awaited<ReturnType<typeof setUpWithEndpointFinding>>) {
      return wrapper.findAll('button').find((b) => b.text().includes('Repair'));
    }

    function findDialogConfirmButton() {
      return new DOMWrapper(document.body)
        .findAll('button')
        .find((b) => b.text() === 'Repair');
    }

    it('opens the confirm dialog mentioning the repair label without calling applyRepair yet', async () => {
      const wrapper = await setUpWithEndpointFinding();
      const store = useDiagnosticsStore();
      const applySpy = vi.spyOn(store, 'applyRepair');

      await findRepairTrigger(wrapper)!.trigger('click');
      await nextTick();

      expect(applySpy).not.toHaveBeenCalled();
      expect(new DOMWrapper(document.body).text()).toContain(endpointFinding.repairAction!.label);
    });

    it('on confirm, calls applyRepair with the finding\'s repairAction, shows a success toast, and re-fetches', async () => {
      const wrapper = await setUpWithEndpointFinding();
      const store = useDiagnosticsStore();
      const applySpy = vi.spyOn(store, 'applyRepair').mockResolvedValue();
      const fetchSpy = vi.spyOn(store, 'fetchDiagnostics').mockResolvedValue();
      const uiStore = useUIStore();

      await findRepairTrigger(wrapper)!.trigger('click');
      await nextTick();

      await findDialogConfirmButton()!.trigger('click');
      await nextTick();
      await Promise.resolve();
      await nextTick();

      expect(applySpy).toHaveBeenCalledWith(endpointFinding.repairAction);
      expect(fetchSpy).toHaveBeenCalled();
      expect(uiStore.toasts.some((t) => t.type === 'success')).toBe(true);
    });

    it('ignores a second confirm fired while a repair is already in flight (double-submit guard)', async () => {
      // Regression test for the Task 63 review finding: `applying` used to
      // be tracked but never actually checked before running the repair,
      // so a rapid double-click on the dialog's Confirm button (still
      // clickable during ConfirmDialog's ~200ms leave transition) could
      // fire applyRepair() twice.
      const wrapper = await setUpWithEndpointFinding();
      const store = useDiagnosticsStore();
      let resolveApply!: () => void;
      const applySpy = vi.spyOn(store, 'applyRepair').mockReturnValue(
        new Promise<void>((resolve) => { resolveApply = resolve; }),
      );
      const fetchSpy = vi.spyOn(store, 'fetchDiagnostics').mockResolvedValue();

      await findRepairTrigger(wrapper)!.trigger('click');
      await nextTick();

      const confirmButton = findDialogConfirmButton()!;
      // Two rapid clicks, neither awaited in between -- simulates a
      // double-click landing before the first call's `applying` guard has
      // had a chance to matter via disabled state alone.
      await confirmButton.trigger('click');
      await confirmButton.trigger('click');
      await nextTick();

      expect(applySpy).toHaveBeenCalledTimes(1);

      resolveApply();
      await nextTick();
      await Promise.resolve();
      await nextTick();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('on failure, shows an error toast with the error message and does not crash', async () => {
      const wrapper = await setUpWithEndpointFinding();
      const store = useDiagnosticsStore();
      vi.spyOn(store, 'applyRepair').mockRejectedValue(new Error('repair failed: service busy'));
      const fetchSpy = vi.spyOn(store, 'fetchDiagnostics').mockResolvedValue();
      const uiStore = useUIStore();

      await findRepairTrigger(wrapper)!.trigger('click');
      await nextTick();

      await findDialogConfirmButton()!.trigger('click');
      await nextTick();
      await Promise.resolve();
      await nextTick();

      const errorToast = uiStore.toasts.find((t) => t.type === 'error');
      expect(errorToast?.message).toContain('repair failed: service busy');
      // A failed repair should not be treated as if it succeeded.
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('renders gracefully with no action area for a finding with no repairAction at all', async () => {
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    const store = useDiagnosticsStore();
    store.findings = [
      {
        id: 'no-repair',
        category: 'snapserver-down',
        severity: 'error',
        message: 'Something is wrong, no repair known.',
      },
    ];
    await nextTick();

    expect(wrapper.text()).toContain('Something is wrong, no repair known.');
    expect(wrapper.findAll('button').filter((b) => b.text().includes('Repair')).length).toBe(0);
  });

  it('manually re-fetches diagnostics when the refresh button is clicked, with no polling interval created', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const wrapper = await mountSmokeTest(Diagnostics, '/diagnostics');
    expect(setIntervalSpy).not.toHaveBeenCalled();

    const store = useDiagnosticsStore();
    const fetchSpy = vi.spyOn(store, 'fetchDiagnostics').mockResolvedValue();

    const refreshButton = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Refresh diagnostics');
    expect(refreshButton, 'expected a refresh button with an aria-label').toBeTruthy();

    await refreshButton!.trigger('click');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
  });
});
