import { describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ClientDashboard from '../ClientDashboard.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useSystemStore } from '../../stores/system';
import { useSnapclientInstancesStore } from '../../stores/snapclientInstances';

describe('ClientDashboard.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(ClientDashboard, '/client');
    expect(wrapper.exists()).toBe(true);
  });

  // Task 31: instance deletion used to call window.confirm() directly. It
  // now opens ConfirmDestructive (type-the-name-to-confirm) instead -- this
  // is the representative real-view integration test for that primitive,
  // proving the full flow end to end: trigger click opens the dialog
  // without calling the API, a wrong typed name keeps confirm disabled and
  // still makes no API call, and only the exact name enables confirm and
  // fires the delete exactly once.
  describe('deleting an instance (ConfirmDestructive integration)', () => {
    async function setUpWithOneInstance() {
      const wrapper = await mountSmokeTest(ClientDashboard, '/client');
      const systemStore = useSystemStore();
      const instanceStore = useSnapclientInstancesStore();

      systemStore.installedPackages.snapclient = true;
      instanceStore.instances = [
        {
          id: 'inst-1',
          name: 'Living Room DAC',
          host: '127.0.0.1',
          port: 1704,
          soundcard: 'hw:0,0',
          instanceNum: 0,
          status: 'active',
        } as any,
      ];
      await nextTick();
      return wrapper;
    }

    function findDeleteTriggerButton(wrapper: Awaited<ReturnType<typeof setUpWithOneInstance>>) {
      return wrapper.findAll('button').find((b) => b.text() === 'Delete Instance');
    }

    function findDialogConfirmButton() {
      return new DOMWrapper(document.body)
        .findAll('button')
        .find((b) => b.text() === 'Delete');
    }

    it('does not call the delete API until the trigger is clicked, and not yet after it opens the dialog', async () => {
      const wrapper = await setUpWithOneInstance();
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const trigger = findDeleteTriggerButton(wrapper);
      expect(trigger).toBeTruthy();
      await trigger!.trigger('click');
      await nextTick();

      expect(fetchMock).not.toHaveBeenCalled();
      // Dialog is now open with the instance's name required.
      expect(new DOMWrapper(document.body).text()).toContain('Living Room DAC');
    });

    it('keeps confirm disabled and makes no API call while the typed name is wrong', async () => {
      const wrapper = await setUpWithOneInstance();
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      await findDeleteTriggerButton(wrapper)!.trigger('click');
      await nextTick();

      const input = new DOMWrapper(document.body).find('input');
      await input.setValue('wrong name');

      const confirmButton = findDialogConfirmButton();
      expect(confirmButton?.attributes('disabled')).toBeDefined();

      await confirmButton?.trigger('click');
      await flushPromises();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('enables confirm on an exact name match and fires the delete API exactly once, then shows a success toast', async () => {
      const wrapper = await setUpWithOneInstance();
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      await findDeleteTriggerButton(wrapper)!.trigger('click');
      await nextTick();

      const input = new DOMWrapper(document.body).find('input');
      await input.setValue('Living Room DAC');

      const confirmButton = findDialogConfirmButton();
      expect(confirmButton?.attributes('disabled')).toBeUndefined();

      await confirmButton?.trigger('click');
      await flushPromises();

      // handleDelete() also calls instanceStore.fetchDevices() afterward (a
      // GET, existing behavior preserved), so assert the DELETE itself
      // fired exactly once rather than asserting fetch's total call count.
      const deleteCalls = fetchMock.mock.calls.filter(
        ([, options]) => (options as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(1);
      expect(String(deleteCalls[0]![0])).toContain('/snapclient-instances/inst-1');

      expect(wrapper.text()).toMatch(/deleted/i);
    });
  });
});
