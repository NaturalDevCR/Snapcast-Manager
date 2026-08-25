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

  // Task 33: with no pipe sources, EmptyState.vue renders in place of the
  // old ad-hoc "No pipe sources configured." markup, and its action slot's
  // button must trigger the SAME add-source flow as the page's regular
  // "Add Source" header button (openAdd) -- not a second, possibly-diverging
  // implementation. Proven behaviorally: clicking it opens the same
  // Add/Edit dialog ("Add Pipe Source" heading), which openAdd is the only
  // function in this component that shows.
  it('renders EmptyState with a wired action that opens the same Add Source dialog as the header button', async () => {
    const wrapper = await mountSmokeTest(PipeSources, '/pipe-sources');
    const store = usePipeSourcesStore();
    store.pipes = [];
    await nextTick();

    // EmptyState.vue is rendered for the empty list, with its action slot.
    expect(wrapper.text()).toContain('No pipe sources configured');
    expect(wrapper.text()).toContain('Add Source');

    // No dialog open yet. The Add/Edit dialog is `<Teleport to="body">`'d,
    // so it lives outside `wrapper`'s own DOM subtree -- check document.body.
    expect(document.body.textContent).not.toContain('Add Pipe Source');

    // The action slot's button is the second "Add Source" trigger on the
    // page (the header has its own). Click it via its accessible text.
    const addSourceButtons = wrapper.findAll('button').filter(b => b.text().includes('Add Source'));
    expect(addSourceButtons.length).toBeGreaterThanOrEqual(2);
    await addSourceButtons[addSourceButtons.length - 1]!.trigger('click');
    await nextTick();

    // openAdd() was invoked: the same Add/Edit dialog now shows its "add"
    // (not "edit") heading, proving this is the real handler, not a stub.
    expect(document.body.textContent).toContain('Add Pipe Source');
  });

  // Task 35: while store.loading is true and store.pipes is still empty
  // (initial page load, before the first fetchPipes() resolves), a
  // Skeleton.vue-based loading branch must render in place of the list --
  // and neither the real card list nor EmptyState (the Task 33 "no pipe
  // sources configured" state) may render at the same time, since loading
  // and "confirmed empty" are different states.
  it('renders a loading skeleton (and not EmptyState or the real list) when store.loading is true and pipes is empty', async () => {
    const wrapper = await mountSmokeTest(PipeSources, '/pipe-sources');
    const store = usePipeSourcesStore();

    store.pipes = [];
    store.loading = true;
    await nextTick();

    // Skeleton.vue's root marks itself role="presentation" -- nothing else
    // in this view uses that role, so its presence proves the skeleton
    // branch rendered.
    const skeletons = wrapper.findAll('[role="presentation"]');
    expect(skeletons.length).toBeGreaterThan(0);

    // EmptyState's copy must NOT show while we're still loading.
    expect(wrapper.text()).not.toContain('No pipe sources configured');

    // No real pipe-source Card rendered either (no pipes yet).
    expect(wrapper.text()).not.toContain('Radio Gym');

    // Once loading finishes with an empty list, the skeleton goes away and
    // EmptyState takes over -- proving the two conditions are mutually
    // exclusive, not just independently true.
    store.loading = false;
    await nextTick();
    expect(wrapper.findAll('[role="presentation"]').length).toBe(0);
    expect(wrapper.text()).toContain('No pipe sources configured');
  });
});
