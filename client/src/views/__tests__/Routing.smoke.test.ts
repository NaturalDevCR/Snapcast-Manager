import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Routing from '../Routing.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useSnapcastStore } from '../../stores/snapcast';
import { useEventSource } from '../../composables/useEventSource';
import { useUIStore } from '../../stores/ui';
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

    const refreshButton = wrapper.findAll('button').find((b) => b.text().includes('Refresh'));
    expect(refreshButton, 'expected to find the Refresh button').toBeTruthy();
    await refreshButton!.trigger('click');

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('redraws the audio-matrix connections when snapcastStore.status changes (SSE push or the initial fetch), not just on a poll tick', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();

    expect(wrapper.text()).toContain('No zones yet');

    // Simulate what useEventSource()'s applySnapcastUpdate() does on a
    // 'snapcast' SSE event: replace store.status wholesale with fresh data.
    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [], stream_id: 's1', muted: false }],
      streams: [{ id: 's1', status: 'playing', uri: { query: { name: 'Radio' }, scheme: 'tcp' } }],
    };
    await nextTick();
    await nextTick(); // let the newly-mounted connector refs attach before the redraw is read

    expect(wrapper.text()).not.toContain('No zones yet');
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

  // Task 34: the cable-drag gesture is mouse/touch-only, so every zone also
  // gets a keyboard/screen-reader-usable <Select> listing every available
  // stream. Picking a different stream there must call the exact same
  // snapcastStore.setGroupStream() the drag-and-drop path calls -- proving
  // the two interaction modes don't fork into divergent implementations.
  it('lets a zone route audio via its accessible Source <Select>, calling the same snapcastStore.setGroupStream() the drag gesture uses', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();
    const setGroupStreamSpy = vi.spyOn(snapcastStore, 'setGroupStream').mockResolvedValue(undefined);

    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [], stream_id: 'a', muted: false }],
      streams: [
        { id: 'a', status: 'playing', uri: { query: { name: 'Radio A' }, scheme: 'tcp' } },
        { id: 'b', status: 'idle', uri: { query: { name: 'Radio B' }, scheme: 'tcp' } },
      ],
    };
    await nextTick();
    await nextTick();

    // The zone's Source <Select> trigger shows the currently-assigned
    // stream's label ("Radio A") as its button text (Select.vue's own
    // tests exercise it the same way: find the trigger button, click to
    // open, click the [role="option"] for the desired value).
    const selectButton = wrapper.findAll('button').find((b) => b.text().includes('Radio A'));
    expect(selectButton, 'expected to find the zone Source <Select> trigger showing "Radio A"').toBeTruthy();
    await selectButton!.trigger('click');

    const optionB = wrapper.findAll('[role="option"]').find((o) => o.text().includes('Radio B'));
    expect(optionB, 'expected a "Radio B" option in the Source <Select>').toBeTruthy();
    await optionB!.trigger('click');
    await nextTick();

    expect(setGroupStreamSpy).toHaveBeenCalledWith('g1', 'b');
  });

  it('routes a zone when a cable is dropped on it, through the same setGroupStream() the <Select> uses', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    document.body.appendChild(wrapper.element); // hit testing skips detached zones
    const snapcastStore = useSnapcastStore();
    const setGroupStreamSpy = vi.spyOn(snapcastStore, 'setGroupStream').mockResolvedValue(undefined);

    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [], stream_id: 'a', muted: false }],
      streams: [
        { id: 'a', status: 'playing', uri: { query: { name: 'Radio A' }, scheme: 'tcp' } },
        { id: 'b', status: 'idle', uri: { query: { name: 'Radio B' }, scheme: 'tcp' } },
      ],
    };
    await nextTick();
    await nextTick();

    // jsdom has no layout: place the zone card where the pointer will drop.
    const zoneCard = wrapper.find('.group\\/zone');
    vi.spyOn(zoneCard.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 60));

    // Radio B has no zones yet, so its handle is the only one left to drag.
    const handles = wrapper.findAll('[title="Drag to connect to a zone"]');
    await handles[handles.length - 1]!.trigger('mousedown', { clientX: 0, clientY: 0 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 130 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    await nextTick();

    expect(setGroupStreamSpy).toHaveBeenCalledWith('g1', 'b');
    wrapper.unmount();
  });

  it('keeps sources with no zones available to drag from, apart from the routed lanes', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();

    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [], stream_id: 'a', muted: false }],
      streams: [
        { id: 'a', status: 'playing', uri: { query: { name: 'Radio A' }, scheme: 'tcp' } },
        { id: 'b', status: 'idle', uri: { query: { name: 'Radio B' }, scheme: 'tcp' } },
      ],
    };
    await nextTick();

    expect(wrapper.text()).toContain('Sources not playing in any zone');
    expect(wrapper.findAll('[title="Drag to connect to a zone"]')).toHaveLength(2);
  });

  it('only offers the filter once there are enough sources and zones to need one', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    const snapcastStore = useSnapcastStore();
    const stream = (id: string) => ({ id, status: 'idle', uri: { query: { name: id }, scheme: 'tcp' } });
    const zone = (id: string) => ({ id, name: id, clients: [], stream_id: 's0', muted: false });

    snapcastStore.status = { server: { version: '1.2.3' }, groups: [zone('Kitchen')], streams: [stream('s0')] };
    await nextTick();
    expect(wrapper.find('input[type="search"]').exists()).toBe(false);

    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [zone('Kitchen'), ...Array.from({ length: 11 }, (_, i) => zone(`Room ${i}`))],
      streams: Array.from({ length: 4 }, (_, i) => stream(`s${i}`)),
    };
    await nextTick();
    await wrapper.find('input[type="search"]').setValue('kitchen');
    await nextTick();

    expect(wrapper.text()).toContain('Kitchen');
    expect(wrapper.text()).not.toContain('Room 0');
  });

  it('renders Spanish copy when locale is switched to "es"', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    useUIStore().setLocale('es');

    // The matrix column headers only render once snapcast data is present,
    // so seed status the way the "redraws the audio-matrix connections" test
    // does, then assert on both the always-visible header copy and the
    // data-dependent column headings.
    const snapcastStore = useSnapcastStore();
    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [{ id: 'g1', name: 'Sala', clients: [], stream_id: 's1', muted: false }],
      streams: [{ id: 's1', status: 'playing', uri: { query: { name: 'Radio' }, scheme: 'tcp' } }],
    };
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain('Matriz de Audio');
    expect(wrapper.text()).toContain('Envía cada fuente a las zonas que deben reproducirla');
    expect(wrapper.text()).toContain('Actualizar');
    expect(wrapper.text()).toContain('Fuentes');
    expect(wrapper.text()).toContain('Zonas');
  });
});
