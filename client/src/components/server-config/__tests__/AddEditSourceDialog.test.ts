// Task 43: focused coverage for the newly-extracted AddEditSourceDialog.vue
// (see .superpowers/sdd/task-43-brief.md). This is ServerConfig.vue's
// highest-risk extraction so far: unlike Tasks 38-42's self-contained or
// single-emit children, this dialog directly mutates deeply-nested paths
// on `localParsedConfig`/`enabledProperties` -- the SAME reactive objects
// the Standard tab's generic property-editor loop reads to render the
// page. The FIRST test below ("propagates a shared-state mutation...") is
// the most important one in this file: it proves that design actually
// works, not just that the dialog opens and closes.
//
// A note on how these tests pass the props (read this before editing):
// AddEditSourceDialog.vue's props are typed as plain objects
// (`Record<string, any>` / `any[]`), NOT `Ref<...>`. That's deliberate --
// empirically verified while building this component. A real
// `<script setup>` parent writing `:localParsedConfig="localParsedConfig"`
// in its template does NOT hand the child a literal `Ref`: Vue's compiler
// auto-unwraps top-level refs referenced in a parent's template, so the
// child receives the current *unwrapped* reactive object instead. (Proof:
// mounting a `Ref` directly through `@vue/test-utils`' `props:` option
// -- bypassing template compilation entirely -- DOES hand the child a
// literal `Ref`, which is a different, misleading result; that only
// happens because `mount()` skips the auto-unwrap a real parent's
// template performs.) So these tests pass `someRef.value` as the prop,
// exactly mirroring what ServerConfig.vue's real template hands down, and
// then assert against `someRef.value` afterwards -- since the component
// only ever mutates nested fields on that object (never reassigns the
// prop itself), object identity is preserved and `someRef.value` reflects
// every mutation the dialog makes.
import { describe, expect, it } from 'vitest';
import { DOMWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import AddEditSourceDialog from '../AddEditSourceDialog.vue';

// @headlessui/vue's Dialog teleports its rendered markup into a real
// `document.body` node, outside the mounted wrapper's own DOM subtree.
const body = () => new DOMWrapper(document.body);

// A small, realistic subset of the server's SOURCE_TEMPLATES
// (server/src/constants/defaultConfig.ts) covering a simple template
// (pipe), the most intricate one (ffmpeg_radio), and the meta-stream
// picker (meta) -- enough to exercise buildSourceUri()'s branches and the
// source-picker functions without dragging in server code.
const SOURCE_TEMPLATES = [
  {
    type: 'pipe',
    label: 'Pipe (FIFO)',
    description: 'Read audio from a named pipe.',
    uriPrefix: 'pipe://',
    pathPlaceholder: '/tmp/snapfifo',
    params: [
      { key: 'name', label: 'Name', description: 'Unique stream name', required: true, type: 'text', placeholder: 'default' },
      { key: 'mode', label: 'Mode', description: 'Pipe creation mode', required: false, type: 'select', default: 'create', options: ['create', 'read'] },
      { key: 'codec', label: 'Codec', description: 'Override codec', required: false, type: 'select', options: ['flac', 'ogg', 'opus', 'pcm'] },
      { key: 'sampleformat', label: 'Sample Format', description: 'rate:bits:channels', required: false, type: 'text', placeholder: '48000:16:2' },
    ],
  },
  {
    type: 'ffmpeg_radio',
    label: '🎵 Internet Radio (FFmpeg)',
    description: 'Stream audio from any URL using FFmpeg.',
    uriPrefix: 'process://',
    pathPlaceholder: '/usr/bin/ffmpeg',
    params: [
      { key: 'name', label: 'Name', description: 'Unique stream name', required: true, type: 'text', placeholder: 'Radio' },
      { key: '_stream_url', label: 'Stream URL', description: 'Full URL', required: true, type: 'text', placeholder: 'https://example.com/radio.mp3' },
      { key: 'codec', label: 'Codec', description: 'Output codec', required: false, type: 'select', default: 'pcm', options: ['pcm', 'flac', 'ogg', 'opus'] },
      { key: 'sampleformat', label: 'Sample Format', description: 'Output format', required: false, type: 'text', default: '48000:16:2' },
      { key: 'idle_threshold', label: 'Idle Threshold (ms)', description: '', required: false, type: 'number', default: '15000' },
      { key: 'send_silence', label: 'Send Silence', description: '', required: false, type: 'boolean', default: 'true' },
      { key: 'log_stderr', label: 'Log stderr', description: '', required: false, type: 'boolean', default: 'false' },
      { key: '_reconnect', label: 'Reconnect on error', description: '', required: false, type: 'boolean', default: 'true' },
      { key: '_reconnect_streamed', label: 'Reconnect streamed', description: '', required: false, type: 'boolean', default: 'true' },
      { key: '_reconnect_at_eof', label: 'Reconnect at EOF', description: '', required: false, type: 'boolean', default: 'false' },
      { key: '_reconnect_on_network_error', label: 'Reconnect on network error', description: '', required: false, type: 'boolean', default: 'false' },
      { key: '_reconnect_delay_max', label: 'Max reconnect delay (s)', description: '', required: false, type: 'number', default: '5' },
    ],
  },
  {
    type: 'meta',
    label: 'Meta (Mixer)',
    description: 'Mix audio from multiple sources.',
    uriPrefix: 'meta://',
    pathPlaceholder: '',
    isMeta: true,
    params: [
      { key: 'name', label: 'Name', description: 'Unique stream name', required: true, type: 'text', placeholder: 'Mix' },
      { key: 'codec', label: 'Codec', description: 'Output codec', required: false, type: 'select', options: ['pcm', 'flac', 'ogg', 'opus'] },
      { key: 'sampleformat', label: 'Sample Format', description: '', required: false, type: 'text', placeholder: '48000:16:2' },
      { key: 'send_silence', label: 'Send Silence', description: '', required: false, type: 'boolean', default: 'true' },
    ],
  },
];

function findByText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
    .find((el) => el.textContent?.trim() === text || el.textContent?.includes(text));
}

function paramField(labelText: string): HTMLInputElement | HTMLSelectElement {
  const label = Array.from(document.body.querySelectorAll<HTMLLabelElement>('label'))
    .find((l) => l.textContent?.trim().startsWith(labelText));
  if (!label) throw new Error(`expected a <label> starting with "${labelText}"`);
  const container = label.parentElement;
  if (!container) throw new Error(`label "${labelText}" has no parent container`);
  const field = container.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  if (!field) throw new Error(`expected an input/select inside the "${labelText}" field`);
  return field;
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

// Mounts the dialog exactly the way ServerConfig.vue's real template
// wires it -- see the file header comment for why `.value` is passed
// explicitly here.
function mountDialog(opts: { localParsedConfig?: Record<string, any>; enabledProperties?: Record<string, Record<string, boolean>> } = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);

  const localParsedConfig = ref<Record<string, any>>(opts.localParsedConfig ?? {});
  const enabledProperties = ref<Record<string, Record<string, boolean>>>(opts.enabledProperties ?? {});
  const sourceTemplates = ref<any[]>(SOURCE_TEMPLATES);

  const wrapper = mount(AddEditSourceDialog, {
    global: { plugins: [pinia] },
    attachTo: document.body,
    props: {
      localParsedConfig: localParsedConfig.value,
      enabledProperties: enabledProperties.value,
      sourceTemplates: sourceTemplates.value,
    },
  });

  return { wrapper, localParsedConfig, enabledProperties };
}

describe('AddEditSourceDialog.vue', () => {
  it('is closed until openAdd()/openEdit() is called', () => {
    mountDialog();

    expect(document.body.textContent).not.toContain('Add Audio Source');
    expect(document.body.textContent).not.toContain('Edit Audio Source');
  });

  // The most important test in this file: proves the ref-as-prop design
  // (see the file header) actually propagates a mutation made inside the
  // child back to whatever holds the ref in the parent -- not just that
  // the dialog UI works.
  it('propagates a shared-state mutation: addSourceFromTemplate() updates the SAME localParsedConfig ref the parent holds', async () => {
    const { wrapper, localParsedConfig, enabledProperties } = mountDialog();

    (wrapper.vm as any).openAdd();
    await nextTick();

    // Step 1: pick the "Pipe (FIFO)" template.
    const pipeTypeButton = findByText('button', 'Pipe (FIFO)');
    expect(pipeTypeButton, 'expected a source-type button for Pipe (FIFO)').toBeTruthy();
    click(pipeTypeButton!);
    await nextTick();

    // Step 2: fill the required "Name" param; leave Path/Host at its
    // template default ("/tmp/snapfifo").
    setInputValue(paramField('Name') as HTMLInputElement, 'My Test Pipe');
    await nextTick();

    // Step 3: submit.
    const submitButton = findByText('button', 'Add Source');
    expect(submitButton, 'expected an "Add Source" submit button').toBeTruthy();
    click(submitButton!);
    await nextTick();

    // The dialog mutated `props.localParsedConfig.stream.source` directly
    // (no emit) -- assert the exact SAME ref object the test (simulating
    // the parent) holds now reflects that mutation.
    expect(localParsedConfig.value.stream.source).toBe('pipe:///tmp/snapfifo?name=My%20Test%20Pipe');
    // Same for the companion `enabledProperties` ref.
    expect(enabledProperties.value.stream?.source).toBe(true);
    // And the dialog closed itself after a successful save. headlessui's
    // Dialog unmounts its content only after its leave transition finishes
    // -- real time (not just microtask ticks) must elapse for that to
    // happen under jsdom (Task 46 conversion).
    await new Promise((resolve) => setTimeout(resolve, 350));
    await nextTick();
    expect(document.body.textContent).not.toContain('Add Audio Source');
  });

  it('openAdd() opens the source-type picker titled "Add Audio Source"', async () => {
    const { wrapper } = mountDialog();

    (wrapper.vm as any).openAdd();
    await nextTick();

    expect(document.body.textContent).toContain('Add Audio Source');
    expect(document.body.textContent).not.toContain('Edit Audio Source');
    // Step 1 (type picker) is showing, not step 2 (param form).
    expect(findByText('button', 'Pipe (FIFO)')).toBeTruthy();
  });

  it('openEdit(idx) parses an existing pipe:// source URI and pre-fills the form, titled "Edit Audio Source"', async () => {
    const { wrapper } = mountDialog({
      localParsedConfig: { stream: { source: 'pipe:///tmp/snapfifo?name=Living%20Room&mode=create' } },
    });

    (wrapper.vm as any).openEdit(0);
    await nextTick();

    expect(document.body.textContent).toContain('Edit Audio Source');
    expect(document.body.textContent).not.toContain('Add Audio Source');
    // Type was auto-detected as "pipe" -> jumps straight to the param
    // form (step 2), skipping the type picker.
    expect(document.body.textContent).toContain('Path / Host');
    expect((paramField('Path / Host') as HTMLInputElement).value).toBe('/tmp/snapfifo');
    expect((paramField('Name') as HTMLInputElement).value).toBe('Living Room');
    expect((paramField('Mode') as HTMLSelectElement).value).toBe('create');
  });

  it('builds a URI for a simple template (pipe) reflected live in the Generated URI preview', async () => {
    const { wrapper } = mountDialog();
    (wrapper.vm as any).openAdd();
    await nextTick();
    click(findByText('button', 'Pipe (FIFO)')!);
    await nextTick();

    setInputValue(paramField('Name') as HTMLInputElement, 'Kitchen');
    await nextTick();

    const preview = document.body.querySelector('code');
    expect(preview?.textContent).toBe('pipe:///tmp/snapfifo?name=Kitchen');
  });

  it('builds a URI for the more intricate ffmpeg_radio template (reconnect flags + encoded params)', async () => {
    const { wrapper } = mountDialog();
    (wrapper.vm as any).openAdd();
    await nextTick();
    click(findByText('button', '🎵 Internet Radio (FFmpeg)')!);
    await nextTick();

    setInputValue(paramField('Name') as HTMLInputElement, 'Test Radio');
    setInputValue(paramField('Stream URL') as HTMLInputElement, 'https://example.com/stream.mp3');
    await nextTick();

    const expectedFfmpegArgs = '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i https://example.com/stream.mp3 -f s16le -ar 48000 -ac 2 -';
    const expectedUri = `process:///usr/bin/ffmpeg?name=Test%20Radio&params=${encodeURIComponent(expectedFfmpegArgs)}`;

    const preview = document.body.querySelector('code');
    expect(preview?.textContent).toBe(expectedUri);
  });

  it('meta-stream source picker: add, reorder (move up), and remove', async () => {
    const { wrapper } = mountDialog({
      localParsedConfig: {
        stream: {
          source: [
            'pipe:///tmp/a?name=Kitchen',
            'pipe:///tmp/b?name=Living%20Room',
          ],
        },
      },
    });
    (wrapper.vm as any).openAdd();
    await nextTick();
    click(findByText('button', 'Meta (Mixer)')!);
    await nextTick();

    // Both non-meta sources are offered as add candidates.
    expect(findByText('button', 'Kitchen'), 'expected a "Kitchen" add-source button').toBeTruthy();
    expect(findByText('button', 'Living Room'), 'expected a "Living Room" add-source button').toBeTruthy();

    // Add Living Room first, then Kitchen -- priority order should track
    // click order.
    click(findByText('button', 'Living Room')!);
    await nextTick();
    click(findByText('button', 'Kitchen')!);
    await nextTick();

    expect(document.body.querySelector('[aria-label="Move Living Room up"]')).toBeTruthy();
    expect(document.body.querySelector('[aria-label="Move Kitchen up"]')).toBeTruthy();

    // Reorder: move Kitchen up so it becomes primary (index 0).
    const moveKitchenUp = document.body.querySelector<HTMLButtonElement>('[aria-label="Move Kitchen up"]');
    expect(moveKitchenUp).toBeTruthy();
    click(moveKitchenUp!);
    await nextTick();

    // Kitchen is now primary: its "move up" button should be disabled.
    const moveKitchenUpAfter = document.body.querySelector<HTMLButtonElement>('[aria-label="Move Kitchen up"]');
    expect(moveKitchenUpAfter?.disabled).toBe(true);

    // Remove Living Room from the priority chain.
    const removeLivingRoom = document.body.querySelector<HTMLButtonElement>('[aria-label="Remove Living Room"]');
    expect(removeLivingRoom).toBeTruthy();
    click(removeLivingRoom!);
    await nextTick();

    expect(document.body.querySelector('[aria-label="Remove Living Room"]')).toBeFalsy();
    expect(document.body.querySelector('[aria-label="Remove Kitchen"]')).toBeTruthy();
  });

  // Task 46: the Teleport-content div this dialog used to render with had no
  // keyboard accessibility (no focus trap, no Escape-to-close, no focus
  // restoration) -- it already had manual backdrop-click-to-close wired up,
  // but not Escape. Converting to headlessui's Dialog gives it a real focus
  // trap, Escape-to-close, and focus restoration all "for free" -- this
  // proves the Escape wiring specifically (headlessui's own focus-trap
  // implementation is already well-tested; see ui/Modal.vue's comment for
  // that posture).
  it('closes on Escape keydown', async () => {
    const { wrapper } = mountDialog();

    (wrapper.vm as any).openAdd();
    await nextTick();

    expect(document.body.textContent).toContain('Add Audio Source');

    await body().trigger('keydown', { key: 'Escape' });
    // headlessui's Dialog unmounts its content only after its leave
    // transition finishes -- real time (not just microtask ticks) must
    // elapse for that to happen under jsdom.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await nextTick();

    expect(document.body.textContent).not.toContain('Add Audio Source');
  });
});
