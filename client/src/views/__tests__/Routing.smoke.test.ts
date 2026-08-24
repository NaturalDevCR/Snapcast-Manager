import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Routing from '../Routing.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useSnapcastStore } from '../../stores/snapcast';
import { useEventSource } from '../../composables/useEventSource';
import { findIconOnlyButtons } from '../../test/iconOnlyButtons';

describe('Routing.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    expect(wrapper.exists()).toBe(true);
  });

  // Task 29: polling is replaced by the app-wide SSE connection (Task 28) --
  // this view must not create its own timer.
  it('does not create its own polling interval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    await mountSmokeTest(Routing, '/routing');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('keeps the manual refresh button wired to snapcastStore.fetchStatus()', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();
    const fetchSpy = vi.spyOn(snapcastStore, 'fetchStatus');

    const refreshButton = wrapper.findAll('button').find((b) => b.text().includes('RE-SYNC INFRASTRUCTURE'));
    expect(refreshButton, 'expected to find the RE-SYNC INFRASTRUCTURE button').toBeTruthy();
    await refreshButton!.trigger('click');

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('redraws the audio-matrix connections when snapcastStore.status changes (SSE push or the initial fetch), not just on a poll tick', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();

    expect(wrapper.text()).toContain('No Snapserver Clusters Identified');

    // Simulate what useEventSource()'s applySnapcastUpdate() does on a
    // 'snapcast' SSE event: replace store.status wholesale with fresh data.
    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [], stream_id: 's1', muted: false }],
      streams: [{ id: 's1', status: 'playing', uri: { query: { name: 'Radio' }, scheme: 'tcp' } }],
    };
    await nextTick();
    await nextTick(); // let the newly-mounted connector refs attach before the redraw is read

    expect(wrapper.text()).not.toContain('No Snapserver Clusters Identified');
    expect(wrapper.findAll('svg path').length).toBeGreaterThan(0);
  });

  it('renders a live/reconnecting SSE status indicator that reflects the composable\'s connection status', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const sse = useEventSource();

    sse.status.value = 'connected';
    await nextTick();
    expect(wrapper.text()).toMatch(/live/i);

    sse.status.value = 'reconnecting';
    await nextTick();
    expect(wrapper.text()).toMatch(/reconnecting/i);
  });

  // Task 32: every icon-only <button> (no visible text content -- just a
  // material-symbols glyph, e.g. the group/client mute toggles) must carry
  // an aria-label so a screen reader user gets an accessible name. This
  // guards against a future edit silently dropping one of those labels.
  it('gives every icon-only button a non-empty aria-label', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();

    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [
        {
          id: 'g1',
          name: 'Living Room',
          clients: [
            {
              id: 'c1',
              connected: true,
              host: { name: 'host1', ip: '10.0.0.1', mac: '00:00:00:00:00:01', os: 'Linux' },
              config: { name: 'Speaker 1', volume: { percent: 50, muted: false } },
            },
          ],
          stream_id: 's1',
          muted: false,
        },
      ],
      streams: [{ id: 's1', status: 'playing', uri: { query: { name: 'Radio' }, scheme: 'tcp' } }],
    };
    await nextTick();

    // Expand the zone (outermost .cursor-pointer is the zone header) so the
    // per-client mute button renders too, alongside the always-visible
    // per-group mute button.
    const zoneHeader = wrapper.findAll('.cursor-pointer')[0];
    if (zoneHeader) await zoneHeader.trigger('click');
    await nextTick();

    const iconOnlyButtons = findIconOnlyButtons(wrapper);
    expect(iconOnlyButtons.length).toBeGreaterThan(0);
    for (const button of iconOnlyButtons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
