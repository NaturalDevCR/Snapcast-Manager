// Task 41: focused coverage for the newly-extracted ConfigEditorModal.vue --
// PipeSources.vue's existing smoke test never exercised this modal's markup
// at all, so this is the first real assertion on its rendered content.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ConfigEditorModal from '../ConfigEditorModal.vue';
import { usePipeSourcesStore, type PipeSource } from '../../../stores/pipeSources';

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

// Teleport(to="body") renders outside `wrapper`'s own root element, so
// @vue/test-utils' wrapper.find()/findAll() can't see this markup (same
// caveat the Task 39/40 tests hit) -- query the real DOM directly instead.
function findByText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
    .find((el) => el.textContent?.includes(text));
}

describe('ConfigEditorModal.vue', () => {
  it('is closed until open(pipe) is called', () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    mount(ConfigEditorModal, { global: { plugins: [pinia] } });

    expect(document.body.textContent).not.toContain('Systemd Service File');
  });

  it('open(pipe) shows a loading state, then store.getConfig()\'s resolved content/filePath', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();

    let resolveConfig!: (value: { content: string; filePath: string }) => void;
    store.getConfig = vi.fn(() => new Promise<{ content: string; filePath: string }>((resolve) => { resolveConfig = resolve; }));

    const wrapper = mount(ConfigEditorModal, { global: { plugins: [pinia] }, attachTo: document.body });

    (wrapper.vm as any).open(samplePipe);
    await nextTick();

    // Modal is open, titled for this pipe, and shows the loading state
    // before store.getConfig() resolves.
    expect(document.body.textContent).toContain('Systemd Service File');
    expect(document.body.textContent).toContain('Radio Gym');
    expect(document.body.textContent).toContain('Loading…');
    expect(store.getConfig).toHaveBeenCalledWith('p1');

    resolveConfig({ content: '[Unit]\nDescription=Radio Gym', filePath: '/etc/systemd/system/pipe-radio-gym.service' });
    await nextTick();
    await nextTick();

    expect(document.body.textContent).not.toContain('Loading…');
    expect(document.body.textContent).toContain('/etc/systemd/system/pipe-radio-gym.service');
    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea?.value).toContain('Description=Radio Gym');
  });

  it('mpd pipes get the "MPD audio_output block" heading', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getConfig = vi.fn().mockResolvedValue({ content: 'audio_output {}', filePath: '/etc/mpd.conf' });

    const wrapper = mount(ConfigEditorModal, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).open({ ...samplePipe, type: 'mpd', name: 'Living Room' });
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('MPD audio_output block');
    expect(document.body.textContent).toContain('Living Room');
  });

  it('a load failure shows an error toast and closes the modal', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getConfig = vi.fn().mockRejectedValue(new Error('load boom'));
    const uiStore = (await import('../../../stores/ui')).useUIStore();
    const toastSpy = vi.spyOn(uiStore, 'showToast');

    const wrapper = mount(ConfigEditorModal, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).open(samplePipe);
    await nextTick();
    await nextTick();
    await nextTick();

    expect(toastSpy).toHaveBeenCalledWith('load boom', 'error');
    expect(document.body.textContent).not.toContain('Systemd Service File');
  });

  it('editing the textarea and saving calls store.setConfig() then store.fetchPipes(), and closes on success', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getConfig = vi.fn().mockResolvedValue({ content: 'old content', filePath: '/etc/systemd/system/pipe-radio-gym.service' });
    store.setConfig = vi.fn().mockResolvedValue(undefined);
    store.fetchPipes = vi.fn().mockResolvedValue(undefined);

    const wrapper = mount(ConfigEditorModal, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).open(samplePipe);
    await nextTick();
    await nextTick();

    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).toBeTruthy();
    textarea!.value = 'new content';
    textarea!.dispatchEvent(new Event('input'));
    await nextTick();

    const saveButton = findByText('button', 'Save & Restart Service');
    expect(saveButton, 'expected a "Save & Restart Service" button').toBeTruthy();
    saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(store.setConfig).toHaveBeenCalledWith('p1', 'new content');
    expect(store.fetchPipes).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Systemd Service File');
  });

  it('a save failure shows an error toast and leaves the modal open (does not auto-close)', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.getConfig = vi.fn().mockResolvedValue({ content: 'old content', filePath: '/etc/systemd/system/pipe-radio-gym.service' });
    store.setConfig = vi.fn().mockRejectedValue(new Error('save boom'));
    store.fetchPipes = vi.fn().mockResolvedValue(undefined);
    const uiStore = (await import('../../../stores/ui')).useUIStore();
    const toastSpy = vi.spyOn(uiStore, 'showToast');

    const wrapper = mount(ConfigEditorModal, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).open(samplePipe);
    await nextTick();
    await nextTick();

    const saveButton = findByText('button', 'Save & Restart Service');
    expect(saveButton, 'expected a "Save & Restart Service" button').toBeTruthy();
    saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(toastSpy).toHaveBeenCalledWith('save boom', 'error');
    expect(store.fetchPipes).not.toHaveBeenCalled();
    // Still open -- the catch block does not close the modal on failure.
    expect(document.body.textContent).toContain('Systemd Service File');
  });
});
