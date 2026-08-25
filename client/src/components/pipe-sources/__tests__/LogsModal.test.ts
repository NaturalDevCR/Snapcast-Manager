// Task 39: focused coverage for the newly-extracted LogsModal.vue --
// PipeSources.vue's existing smoke test never exercised this modal's
// markup at all (it only ever checked the modal was CLOSED via
// `document.body.textContent`), so this is the first real assertion on
// its rendered content.
import { describe, expect, it, vi } from 'vitest';
import { DOMWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import LogsModal from '../LogsModal.vue';
import { usePipeSourcesStore, type PipeSource } from '../../../stores/pipeSources';

// @headlessui/vue's Dialog teleports its rendered markup into a real
// `document.body` node, outside the mounted wrapper's own DOM subtree.
const body = () => new DOMWrapper(document.body);

const samplePipe: PipeSource = {
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
};

describe('LogsModal.vue', () => {
  it('is closed until open(pipe) is called', () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    mount(LogsModal, { global: { plugins: [pinia] } });

    expect(document.body.textContent).not.toContain('Logs —');
  });

  it('open(pipe) shows a loading state, then store.getLogs()\'s resolved content', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();

    let resolveLogs!: (value: string) => void;
    store.getLogs = vi.fn(() => new Promise<string>((resolve) => { resolveLogs = resolve; }));

    const wrapper = mount(LogsModal, { global: { plugins: [pinia] } });

    (wrapper.vm as any).open(samplePipe);
    await nextTick();

    // Modal is open, titled for this pipe, and shows the loading state
    // before store.getLogs() resolves.
    expect(document.body.textContent).toContain('Logs — Radio Gym');
    expect(document.body.textContent).toContain('Loading logs…');
    expect(store.getLogs).toHaveBeenCalledWith('p1');

    resolveLogs('line one\nline two');
    await nextTick();
    await nextTick();

    expect(document.body.textContent).not.toContain('Loading logs…');
    expect(document.body.textContent).toContain('line one');
    expect(document.body.textContent).toContain('line two');
  });

  it('mpd pipes get a "(mpd service)" suffix on the title', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getLogs = vi.fn().mockResolvedValue('');

    const wrapper = mount(LogsModal, { global: { plugins: [pinia] } });
    (wrapper.vm as any).open({ ...samplePipe, type: 'mpd', name: 'Living Room' });
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('Logs — Living Room (mpd service)');
  });

  it('shows an error message in place of logs content when store.getLogs() rejects', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getLogs = vi.fn().mockRejectedValue(new Error('boom'));

    const wrapper = mount(LogsModal, { global: { plugins: [pinia] } });
    (wrapper.vm as any).open(samplePipe);
    await nextTick();
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('Error loading logs: boom');
  });

  // Task 46: the Teleport-content div this modal used to render with had no
  // keyboard accessibility (no focus trap, no Escape-to-close, no focus
  // restoration). Converting to headlessui's Dialog gives it all three "for
  // free" -- this proves the Escape wiring specifically (headlessui's own
  // focus-trap implementation is already well-tested; see ui/Modal.vue's
  // comment for that posture).
  it('closes on Escape keydown', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getLogs = vi.fn().mockResolvedValue('some logs');

    const wrapper = mount(LogsModal, { global: { plugins: [pinia] } });
    (wrapper.vm as any).open(samplePipe);
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('Logs — Radio Gym');

    await body().trigger('keydown', { key: 'Escape' });
    // headlessui's Dialog unmounts its content only after its leave
    // transition finishes -- real time (not just microtask ticks) must
    // elapse for that to happen under jsdom.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await nextTick();

    expect(document.body.textContent).not.toContain('Logs — Radio Gym');
  });
});
