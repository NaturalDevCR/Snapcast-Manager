// Task 42: focused coverage for the newly-extracted AddEditPipeDialog.vue --
// PipeSources.vue's existing smoke test only ever asserts openAdd() opens
// the dialog (Task 33's EmptyState-CTA test); it never exercised the form's
// prefill, validation, or save behavior. This is the first real assertion
// on that content, plus the new `saved` emit this task introduced (the
// `needsRestart` cross-cutting flag stays in the parent -- see
// .superpowers/sdd/task-42-brief.md).
import { describe, expect, it, vi } from 'vitest';
import { DOMWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import AddEditPipeDialog from '../AddEditPipeDialog.vue';
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

// Teleport(to="body") renders outside `wrapper`'s own root element, so
// @vue/test-utils' wrapper.find()/findAll() can't see this markup (same
// caveat the Task 39-41 tests hit) -- query the real DOM directly instead.
function findByText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
    .find((el) => el.textContent?.includes(text));
}

function nameInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[type="text"]');
  if (!input) throw new Error('expected the name <input type="text">');
  return input;
}

function urlInput(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>('input[type="url"]');
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('AddEditPipeDialog.vue', () => {
  it('is closed until openAdd()/openEdit() is called', () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    mount(AddEditPipeDialog, { global: { plugins: [pinia] } });

    expect(document.body.textContent).not.toContain('Add Pipe Source');
    expect(document.body.textContent).not.toContain('Edit Pipe Source');
  });

  it('openAdd() shows a blank form titled "Add Pipe Source"', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openAdd();
    await nextTick();

    expect(document.body.textContent).toContain('Add Pipe Source');
    expect(document.body.textContent).not.toContain('Edit Pipe Source');
    expect(nameInput().value).toBe('');
    expect(urlInput()?.value).toBe('');
  });

  it('openEdit(pipe) shows the form pre-filled with that pipe\'s values, titled "Edit Pipe Source"', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openEdit(samplePipe);
    await nextTick();

    expect(document.body.textContent).toContain('Edit Pipe Source');
    expect(document.body.textContent).not.toContain('Add Pipe Source');
    expect(nameInput().value).toBe('Radio Gym');
    expect(urlInput()?.value).toBe('https://example.com/radio.mp3');
  });

  it('a successful create emits saved with snapserverConfigChanged: true', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.createPipe = vi.fn().mockResolvedValue({ ...samplePipe, id: 'p2' });

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openAdd();
    await nextTick();

    setInputValue(nameInput(), 'New Station');
    setInputValue(urlInput()!, 'https://example.com/new.mp3');
    await nextTick();

    const createButton = findByText('button', 'Create');
    expect(createButton, 'expected a "Create" button').toBeTruthy();
    createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(store.createPipe).toHaveBeenCalled();
    expect(wrapper.emitted('saved')).toEqual([[{ snapserverConfigChanged: true }]]);
    // Dialog closes on successful save. headlessui's Dialog unmounts its
    // content only after its leave transition finishes -- real time (not
    // just microtask ticks) must elapse for that to happen under jsdom
    // (Task 46 conversion; see ConfigEditorModal.test.ts for the same wait).
    await new Promise((resolve) => setTimeout(resolve, 350));
    await nextTick();
    expect(document.body.textContent).not.toContain('Add Pipe Source');
  });

  it('a config-relevant update (name change) emits saved with snapserverConfigChanged: true', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.pipes = [samplePipe];
    store.updatePipe = vi.fn().mockResolvedValue({ ...samplePipe, name: 'Renamed' });

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openEdit(samplePipe);
    await nextTick();

    setInputValue(nameInput(), 'Renamed');
    await nextTick();

    const updateButton = findByText('button', 'Update');
    expect(updateButton, 'expected an "Update" button').toBeTruthy();
    updateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(store.updatePipe).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Renamed' }));
    expect(wrapper.emitted('saved')).toEqual([[{ snapserverConfigChanged: true }]]);
  });

  it('an update that does not touch snapserver-relevant fields emits saved with snapserverConfigChanged: false', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.pipes = [samplePipe];
    store.updatePipe = vi.fn().mockResolvedValue({ ...samplePipe, url: 'https://example.com/changed.mp3' });

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openEdit(samplePipe);
    await nextTick();

    // Only the URL changes -- name/type/idleThreshold (the only fields
    // saveDialog() checks) are untouched, so this is NOT snapserver-relevant.
    setInputValue(urlInput()!, 'https://example.com/changed.mp3');
    await nextTick();

    const updateButton = findByText('button', 'Update');
    updateButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await nextTick();

    expect(store.updatePipe).toHaveBeenCalled();
    expect(wrapper.emitted('saved')).toEqual([[{ snapserverConfigChanged: false }]]);
  });

  it('refuses to save and shows a toast (no saved emit) when the name is missing', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.createPipe = vi.fn();
    const uiStore = (await import('../../../stores/ui')).useUIStore();
    const toastSpy = vi.spyOn(uiStore, 'showToast');

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openAdd();
    await nextTick();

    setInputValue(urlInput()!, 'https://example.com/new.mp3');
    await nextTick();

    const createButton = findByText('button', 'Create');
    createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(toastSpy).toHaveBeenCalledWith('Name is required', 'error');
    expect(store.createPipe).not.toHaveBeenCalled();
    expect(wrapper.emitted('saved')).toBeUndefined();
    // Dialog stays open.
    expect(document.body.textContent).toContain('Add Pipe Source');
  });

  it('refuses to save and shows a toast (no saved emit) when a radio source is missing its Stream URL', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.createPipe = vi.fn();
    const uiStore = (await import('../../../stores/ui')).useUIStore();
    const toastSpy = vi.spyOn(uiStore, 'showToast');

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openAdd();
    await nextTick();

    setInputValue(nameInput(), 'New Station');
    await nextTick();

    const createButton = findByText('button', 'Create');
    createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(toastSpy).toHaveBeenCalledWith('Stream URL is required for Radio sources', 'error');
    expect(store.createPipe).not.toHaveBeenCalled();
    expect(wrapper.emitted('saved')).toBeUndefined();
    expect(document.body.textContent).toContain('Add Pipe Source');
  });

  // Task 46: the Teleport-content div this dialog used to render with had no
  // keyboard accessibility (no focus trap, no Escape-to-close, no focus
  // restoration). Converting to headlessui's Dialog gives it all three "for
  // free" -- this proves the Escape wiring specifically (headlessui's own
  // focus-trap implementation is already well-tested; see ui/Modal.vue's
  // comment for that posture).
  it('closes on Escape keydown', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const wrapper = mount(AddEditPipeDialog, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).openAdd();
    await nextTick();

    expect(document.body.textContent).toContain('Add Pipe Source');

    await body().trigger('keydown', { key: 'Escape' });
    // headlessui's Dialog unmounts its content only after its leave
    // transition finishes -- real time (not just microtask ticks) must
    // elapse for that to happen under jsdom.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await nextTick();

    expect(document.body.textContent).not.toContain('Add Pipe Source');
  });
});
