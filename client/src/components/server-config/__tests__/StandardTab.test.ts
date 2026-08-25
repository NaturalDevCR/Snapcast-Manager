// Task 44: focused coverage for the newly-extracted StandardTab.vue (see
// .superpowers/sdd/task-44-brief.md). Same shared-mutable-state design as
// Task 43's AddEditSourceDialog.vue -- read that test file's header
// comment for the full empirical justification of why these tests pass
// `someRef.value` as the prop (mirroring what ServerConfig.vue's real
// template hands down via Vue's `<script setup>` template auto-unwrap) and
// assert against `someRef.value` afterwards.
//
// The SECOND test below ("propagates a shared-state mutation...") is the
// most important one in this file, mirroring Task 43's precedent: it
// proves toggling a property actually mutates the SAME
// `localParsedConfig`/`enabledProperties` objects the parent holds, not
// just that the UI reacts locally.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import StandardTab from '../StandardTab.vue';

// A small, realistic subset of the server's CONFIG_METADATA/CONFIG_SECTIONS
// (server/src/constants/defaultConfig.ts) -- enough to exercise the
// section-switcher, the boolean/text/number/select property editor
// branches, and the Add Custom Property flow, without dragging in server
// code.
const CONFIG_METADATA: Record<string, any> = {
  server: {
    mdns_enabled: { label: 'mDNS', type: 'boolean', default: 'true', description: 'Publish services via mDNS.' },
    pidfile: { label: 'PID File', type: 'text', default: '/var/run/snapserver/pid', description: 'Path to the PID file.' },
  },
  http: {
    port: { label: 'Port', type: 'number', default: 1780, description: 'HTTP listening port.' },
  },
  logging: {
    sink: { label: 'Log Sink', type: 'select', default: '', options: ['', 'null', 'system', 'stdout', 'stderr'], description: 'Log output destination.' },
  },
  stream: {
    source: { label: 'Audio Sources', type: 'list', description: 'Input stream URIs.' },
  },
};

const CONFIG_SECTIONS: Record<string, { label: string; description: string }> = {
  server: { label: 'Server', description: 'General server settings like threads, user, and mDNS' },
  ssl: { label: 'SSL / TLS', description: 'Certificate and encryption settings' },
  http: { label: 'HTTP / WebSocket', description: 'HTTP/HTTPS and WebSocket control and streaming' },
  'tcp-control': { label: 'TCP Control', description: 'TCP JSON-RPC control interface' },
  'tcp-streaming': { label: 'TCP Streaming', description: 'TCP raw audio streaming' },
  stream: { label: 'Stream', description: 'Audio sources, codecs, and buffer settings' },
  streaming_client: { label: 'Clients', description: 'Default settings for streaming clients' },
  logging: { label: 'Logging', description: 'Log output and filtering' },
};

// Minimal source template so the Audio Sources sub-section's "Add Source"
// button reaches a real AddEditSourceDialog.vue (Task 43) with at least one
// choosable type -- this is an INTEGRATION check (the dialog's own behavior
// is already covered in depth by AddEditSourceDialog.test.ts), matching how
// the brief asks this task to confirm the connection point still works,
// not re-test AddEditSourceDialog.vue itself.
const SOURCE_TEMPLATES = [
  {
    type: 'pipe',
    label: 'Pipe (FIFO)',
    description: 'Read audio from a named pipe.',
    uriPrefix: 'pipe://',
    pathPlaceholder: '/tmp/snapfifo',
    params: [
      { key: 'name', label: 'Name', description: 'Unique stream name', required: true, type: 'text', placeholder: 'default' },
    ],
  },
];

function findByText(selector: string, text: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector))
    .find((el) => el.textContent?.trim() === text || el.textContent?.includes(text));
}

// Section-switcher tab buttons contain BOTH a material-icon ligature (e.g.
// "queue_music") and the label text (e.g. "Stream") -- a plain substring
// search over button text is ambiguous here ("TCP Streaming" contains
// "Stream" too, and precedes "Stream" in DOM order), so this looks for the
// exact-match `<span>` the template renders the label into
// (`<span>{{ configSections[sKey]?.label || sKey }}</span>`) and returns
// its button ancestor.
function sectionTab(labelText: string): HTMLElement {
  const span = Array.from(document.body.querySelectorAll<HTMLElement>('span'))
    .find((el) => el.children.length === 0 && el.textContent?.trim() === labelText);
  if (!span) throw new Error(`expected a section tab labeled "${labelText}"`);
  const btn = span.closest<HTMLElement>('button');
  if (!btn) throw new Error(`section tab label "${labelText}" has no button ancestor`);
  return btn;
}

// Finds the property-editor row (the `.grid ... md:grid-cols-12` div) whose
// label starts with the given text -- the toggle button lives in one
// column of the row, the label in another, and the value input/select in a
// third, so tests need to walk up to the shared row container first.
function propertyRow(labelText: string): HTMLElement {
  const label = Array.from(document.body.querySelectorAll<HTMLLabelElement>('label'))
    .find((l) => l.textContent?.trim().startsWith(labelText));
  if (!label) throw new Error(`expected a <label> starting with "${labelText}"`);
  const row = label.closest<HTMLElement>('.grid');
  if (!row) throw new Error(`label "${labelText}" has no row ancestor`);
  return row;
}

function propertyField(labelText: string): HTMLInputElement | HTMLSelectElement {
  const field = propertyRow(labelText).querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  if (!field) throw new Error(`expected an input/select inside the "${labelText}" row`);
  return field;
}

function propertyToggle(labelText: string): HTMLButtonElement {
  const btn = propertyRow(labelText).querySelector<HTMLButtonElement>('button');
  if (!btn) throw new Error(`expected a toggle button inside the "${labelText}" row`);
  return btn;
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

// Mounts the tab exactly the way ServerConfig.vue's real template wires it
// -- see the file header comment for why `.value` is passed explicitly.
function mountTab(opts: {
  localParsedConfig?: Record<string, any>;
  enabledProperties?: Record<string, Record<string, boolean>>;
} = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);

  const localParsedConfig = ref<Record<string, any>>(opts.localParsedConfig ?? {});
  const enabledProperties = ref<Record<string, Record<string, boolean>>>(opts.enabledProperties ?? {});
  const configMetadata = ref<Record<string, any>>(CONFIG_METADATA);
  const configSections = ref<Record<string, any>>(CONFIG_SECTIONS);
  const sourceTemplates = ref<any[]>(SOURCE_TEMPLATES);

  const wrapper = mount(StandardTab, {
    global: { plugins: [pinia] },
    attachTo: document.body,
    props: {
      localParsedConfig: localParsedConfig.value,
      enabledProperties: enabledProperties.value,
      configMetadata: configMetadata.value,
      configSections: configSections.value,
      sourceTemplates: sourceTemplates.value,
    },
  });

  return { wrapper, localParsedConfig, enabledProperties };
}

describe('StandardTab.vue', () => {
  it('renders the section-switcher tabs and switches the active section on click', async () => {
    const { wrapper } = mountTab();

    // All 8 fixed sections render as tabs (their labels come from the
    // configSections prop).
    expect(wrapper.text()).toContain('Server');
    expect(wrapper.text()).toContain('HTTP / WebSocket');
    expect(wrapper.text()).toContain('Logging');

    // Defaults to the 'server' section.
    expect(wrapper.text()).toContain('General server settings like threads, user, and mDNS');

    const httpTab = sectionTab('HTTP / WebSocket');
    expect(httpTab, 'expected an "HTTP / WebSocket" section tab').toBeTruthy();
    click(httpTab!);
    await nextTick();

    expect(wrapper.text()).toContain('HTTP/HTTPS and WebSocket control and streaming');
  });

  // The most important test in this file: proves the shared-props design
  // (see the file header) actually propagates a mutation made inside the
  // child back to whatever holds the ref in the parent -- not just that
  // the toggle UI updates locally.
  it('propagates a shared-state mutation: toggling a boolean property updates the SAME enabledProperties/localParsedConfig refs the parent holds', async () => {
    const { localParsedConfig, enabledProperties } = mountTab();

    // 'server'/'mdns_enabled' starts disabled (not present in localParsedConfig).
    expect(enabledProperties.value.server?.mdns_enabled).toBeFalsy();

    const toggle = propertyToggle('mDNS');
    click(toggle);
    await nextTick();

    // Enabling seeds localParsedConfig with the metadata default, as a
    // string (matches the original ServerConfig.vue behavior).
    expect(enabledProperties.value.server?.mdns_enabled).toBe(true);
    expect(localParsedConfig.value.server?.mdns_enabled).toBe('true');

    // Toggling again disables it and removes the key from localParsedConfig.
    click(toggle);
    await nextTick();

    expect(enabledProperties.value.server?.mdns_enabled).toBe(false);
    expect(localParsedConfig.value.server?.mdns_enabled).toBeUndefined();
  });

  it('edits text, number, and select property values, mutating the shared localParsedConfig directly', async () => {
    const { wrapper, localParsedConfig } = mountTab({
      localParsedConfig: {
        server: { pidfile: '/var/run/snapserver/pid' },
        http: { port: '1780' },
        logging: { sink: '' },
      },
      enabledProperties: {
        server: { pidfile: true },
        http: { port: true },
        logging: { sink: true },
      },
    });

    // Text input (server section, active by default).
    setInputValue(propertyField('PID File') as HTMLInputElement, '/custom/path/pid');
    await nextTick();
    expect(localParsedConfig.value.server.pidfile).toBe('/custom/path/pid');

    // Number input (http section).
    click(sectionTab('HTTP / WebSocket'));
    await nextTick();
    setInputValue(propertyField('Port') as HTMLInputElement, '9999');
    await nextTick();
    expect(localParsedConfig.value.http.port).toBe('9999');

    // Select dropdown (logging section).
    click(sectionTab('Logging'));
    await nextTick();
    setSelectValue(propertyField('Log Sink') as HTMLSelectElement, 'stdout');
    await nextTick();
    expect(localParsedConfig.value.logging.sink).toBe('stdout');

    expect(wrapper.exists()).toBe(true);
  });

  it('adds a custom property via the "Custom" trigger -> PromptDialog -> confirm flow', async () => {
    const { localParsedConfig, enabledProperties } = mountTab();

    const customBtn = findByText('button', 'Custom');
    expect(customBtn, 'expected a "Custom" (Add Custom Property) trigger button').toBeTruthy();
    click(customBtn!);
    await nextTick();

    expect(document.body.textContent).toContain('Add Custom Property');
    expect(document.body.textContent).toContain('[server]');

    const input = document.body.querySelector<HTMLInputElement>('input[placeholder="e.g. custom_key"]');
    expect(input, 'expected the PromptDialog\'s text input').toBeTruthy();
    setInputValue(input!, 'my_custom_key');
    await nextTick();

    const saveBtn = findByText('button', 'Save');
    expect(saveBtn, 'expected the PromptDialog\'s "Save" confirm button').toBeTruthy();
    click(saveBtn!);
    await nextTick();

    expect(localParsedConfig.value.server?.my_custom_key).toBe('');
    expect(enabledProperties.value.server?.my_custom_key).toBe(true);
  });

  it('renders the Audio Sources sub-section on the stream section, and its Add/Edit/Remove triggers reach the moved-in AddEditSourceDialog correctly', async () => {
    const { wrapper, localParsedConfig } = mountTab({
      localParsedConfig: {
        stream: {
          source: [
            'pipe:///tmp/a?name=Kitchen',
            'pipe:///tmp/b?name=Living%20Room',
          ],
        },
      },
    });

    click(sectionTab('Stream'));
    await nextTick();

    expect(wrapper.text()).toContain('Kitchen');
    expect(wrapper.text()).toContain('Living Room');
    expect(wrapper.text()).toContain('Pipe');

    // "Add Source" reaches AddEditSourceDialog.vue (Task 43) -- integration
    // point only; the dialog's own internals are covered by
    // AddEditSourceDialog.test.ts.
    click(findByText('button', 'Add Source')!);
    await nextTick();
    expect(document.body.textContent).toContain('Add Audio Source');

    const closeBtn = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(closeBtn).toBeTruthy();
    click(closeBtn!);
    await nextTick();

    // "Edit" reaches AddEditSourceDialog.vue's openEdit(idx), pre-filling
    // from the shared localParsedConfig.
    const editKitchen = document.body.querySelector<HTMLButtonElement>('[aria-label="Edit Kitchen"]');
    expect(editKitchen, 'expected an "Edit Kitchen" trigger').toBeTruthy();
    click(editKitchen!);
    await nextTick();
    expect(document.body.textContent).toContain('Edit Audio Source');
    expect(document.body.textContent).toContain('Path / Host');

    const closeBtn2 = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    click(closeBtn2!);
    await nextTick();

    // "Remove" mutates the SAME shared localParsedConfig ref directly
    // (removeSourceEntry), collapsing the remaining single-item array back
    // to a plain string -- same behavior as the original ServerConfig.vue.
    const removeKitchen = document.body.querySelector<HTMLButtonElement>('[aria-label="Remove Kitchen"]');
    expect(removeKitchen, 'expected a "Remove Kitchen" trigger').toBeTruthy();
    click(removeKitchen!);
    await nextTick();

    expect(localParsedConfig.value.stream.source).toBe('pipe:///tmp/b?name=Living%20Room');
  });
});
