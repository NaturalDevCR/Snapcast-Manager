// Task 40: focused coverage for the newly-extracted ImportModal.vue --
// PipeSources.vue's existing smoke test never exercised this modal's
// discovery/adopt flow at all, so this is the first real assertion on
// its behavior.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import ImportModal from '../ImportModal.vue';
import { usePipeSourcesStore, type DiscoveredPipe, type PipeSource } from '../../../stores/pipeSources';

const discoveredRadio: DiscoveredPipe = {
  name: 'Kitchen Radio',
  fifoPath: '/tmp/snapfifo_kitchen',
  sourceUri: 'pipe:///tmp/snapfifo_kitchen?name=Kitchen',
  idleThreshold: 15000,
  detectedType: 'radio',
  existingService: null,
};

describe('ImportModal.vue', () => {
  it('is closed until open() is called', () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    mount(ImportModal, { global: { plugins: [pinia] } });

    expect(document.body.textContent).not.toContain('Import Existing Pipe Sources');
  });

  it('open() scans for unmanaged sources and lists what store.discoverPipes() resolves', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();

    let resolveDiscovery!: (value: DiscoveredPipe[]) => void;
    store.discoverPipes = vi.fn(() => new Promise<DiscoveredPipe[]>((resolve) => { resolveDiscovery = resolve; }));

    const wrapper = mount(ImportModal, { global: { plugins: [pinia] } });
    (wrapper.vm as any).open();
    await nextTick();

    // Modal is open and shows the scanning state before discoverPipes() resolves.
    expect(document.body.textContent).toContain('Import Existing Pipe Sources');
    expect(document.body.textContent).toContain('Scanning snapserver config');
    expect(store.discoverPipes).toHaveBeenCalled();

    resolveDiscovery([discoveredRadio]);
    await nextTick();
    await nextTick();

    expect(document.body.textContent).not.toContain('Scanning snapserver config');
    expect(document.body.textContent).toContain('Kitchen Radio');
    expect(document.body.textContent).toContain('/tmp/snapfifo_kitchen');
  });

  it('shows the EmptyState when store.discoverPipes() resolves with nothing', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.discoverPipes = vi.fn().mockResolvedValue([]);

    const wrapper = mount(ImportModal, { global: { plugins: [pinia] } });
    (wrapper.vm as any).open();
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('No unmanaged pipe:// sources found');
  });

  // Teleport(to="body") renders outside `wrapper`'s own root element, so
  // @vue/test-utils' wrapper.find()/findAll() can't see this markup (same
  // caveat the Task 33/39 tests hit) -- query the real DOM directly instead.
  function findByText(selector: string, text: string): HTMLElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
      .find((el) => el.textContent?.includes(text));
  }

  it('adopting a discovered source calls store.adoptPipe() with the built input and marks it imported', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.discoverPipes = vi.fn().mockResolvedValue([discoveredRadio]);

    let resolveAdopt!: (value: PipeSource) => void;
    store.adoptPipe = vi.fn(() => new Promise<PipeSource>((resolve) => { resolveAdopt = resolve; }));

    const wrapper = mount(ImportModal, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).open();
    await nextTick();
    await nextTick();

    // Radio type is the default; give it a URL (required before adopting).
    const urlInput = document.body.querySelector<HTMLInputElement>('input[type="url"]');
    expect(urlInput, 'expected the discovered item\'s URL input to be in the DOM').toBeTruthy();
    urlInput!.value = 'https://example.com/kitchen.mp3';
    urlInput!.dispatchEvent(new Event('input'));
    await nextTick();

    const importButton = findByText('button', 'Import');
    expect(importButton, 'expected an "Import" button for the discovered item').toBeTruthy();
    importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(store.adoptPipe).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Kitchen Radio',
        type: 'radio',
        url: 'https://example.com/kitchen.mp3',
      })
    );
    expect(document.body.textContent).toContain('Importing…');

    resolveAdopt({} as PipeSource);
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('Imported');
  });

  it('refuses to adopt a radio source with no URL', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = usePipeSourcesStore();
    store.discoverPipes = vi.fn().mockResolvedValue([discoveredRadio]);
    store.adoptPipe = vi.fn();
    const uiStore = (await import('../../../stores/ui')).useUIStore();
    const toastSpy = vi.spyOn(uiStore, 'showToast');

    const wrapper = mount(ImportModal, { global: { plugins: [pinia] }, attachTo: document.body });
    (wrapper.vm as any).open();
    await nextTick();
    await nextTick();

    const importButton = findByText('button', 'Import');
    expect(importButton, 'expected an "Import" button for the discovered item').toBeTruthy();
    importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(store.adoptPipe).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Stream URL is required'), 'error');
  });
});
