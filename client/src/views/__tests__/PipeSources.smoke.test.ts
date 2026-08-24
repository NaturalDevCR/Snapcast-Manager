import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import PipeSources from '../PipeSources.vue';
import { mountSmokeTest } from '../../test/mountView';
import { usePipeSourcesStore } from '../../stores/pipeSources';
import { findIconOnlyButtons } from '../../test/iconOnlyButtons';

describe('PipeSources.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(PipeSources, '/pipe-sources');
    expect(wrapper.exists()).toBe(true);
  });

  // Task 32: with at least one pipe source rendered, each card's Start/
  // Stop/Restart/Logs/Delete controls are icon-only <button>s -- guard
  // against a future edit silently dropping one of their aria-labels.
  it('gives every icon-only button a non-empty aria-label', async () => {
    const wrapper = await mountSmokeTest(PipeSources, '/pipe-sources');
    const store = usePipeSourcesStore();

    store.pipes = [
      {
        id: 'p1',
        name: 'Radio Gym',
        type: 'radio',
        url: 'https://example.com/radio.mp3',
        reconnect: true,
        reconnectStreamed: true,
        reconnectAtEof: true,
        reconnectDelayMax: 30,
        idleThreshold: 15000,
        enabled: true,
        createdAt: new Date().toISOString(),
        status: 'active',
        fifoPath: '/tmp/snapfifo_radio_gym',
        serviceName: 'pipe-radio-gym',
      },
    ];
    await nextTick();

    const iconOnlyButtons = findIconOnlyButtons(wrapper);
    expect(iconOnlyButtons.length).toBeGreaterThan(0);
    for (const button of iconOnlyButtons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
