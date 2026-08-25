// Task 45: focused coverage for the newly-extracted ExpertTab.vue (see
// .superpowers/sdd/task-45-brief.md).
//
// UNLIKE Task 43/44's AddEditSourceDialog.vue/StandardTab.vue tests (which
// pass a plain object prop and assert against the SAME object afterwards,
// relying on JS object-reference semantics), this component's shared state
// is a plain STRING wired through `defineModel`. That needs
// `wrapper.setProps({ rawConfig: ... })` / `wrapper.emitted('update:rawConfig')`
// to exercise -- the standard @vue/test-utils v-model testing idiom -- not
// the "mutate the shared object, assert on the object" pattern.
//
// `prism-code-editor` (the real editor library) is mocked here rather than
// exercised for real. Empirically confirmed while writing this test: under
// jsdom, `basicEditor()` neither throws NOR renders any DOM content into its
// container -- it silently no-ops (no ResizeObserver/rAF-related error, just
// an empty `<div class="pce-custom">`). That's not a regression from this
// extraction: the ORIGINAL `ServerConfig.vue` had ZERO test coverage of the
// editor's real behavior either -- its smoke test
// (`views/__tests__/ServerConfig.smoke.test.ts`) mounts on the default
// 'standard' tab and never switches to 'expert', so `basicEditor()` was
// never even invoked there, headlessly-real or otherwise. Mocking it here is
// a NET INCREASE in coverage versus the pre-Task-45 baseline (zero), and lets
// this file prove the one thing this task actually changes -- that the
// `defineModel` binding genuinely propagates a value in BOTH directions --
// deterministically, without depending on prism-code-editor's undocumented
// jsdom behavior.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

let capturedUpdateCallback: ((value: string) => void) | null = null;
const setOptionsSpy = vi.fn();

vi.mock('prism-code-editor/setups', () => ({
  basicEditor: (
    _el: HTMLElement,
    options: { value: string },
    onReady: () => void,
  ) => {
    const instance = {
      value: options.value,
      setOptions: setOptionsSpy,
      on: (event: string, cb: (value: string) => void) => {
        if (event === 'update') capturedUpdateCallback = cb;
      },
    };
    // Real prism-code-editor invokes its onReady callback asynchronously
    // (after basicEditor() has already returned and been assigned to
    // `editorInstance`) -- that's WHY the original code's onReady body
    // guards with `if (editorInstance && ...)` before calling `.on(...)`.
    // Calling onReady synchronously here (before this function returns)
    // would make that guard fail even in production, so the mock defers
    // it a tick to match real timing.
    Promise.resolve().then(onReady);
    return instance;
  },
}));

import ExpertTab from '../ExpertTab.vue';

function findByText(text: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLElement>('button'))
    .find((el) => el.textContent?.trim() === text || el.textContent?.includes(text));
}

describe('ExpertTab.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    capturedUpdateCallback = null;
    setOptionsSpy.mockClear();
  });

  it('mounts without throwing', () => {
    const wrapper = mount(ExpertTab, { props: { rawConfig: 'server { }' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('propagates a parent-side write into the editor (parent -> child)', async () => {
    const wrapper = mount(ExpertTab, { props: { rawConfig: 'server = 1' } });
    await nextTick();

    // Simulates fetchBoth()/"Revert" reassigning ServerConfig.vue's
    // `localRawConfig.value` -- with defineModel, that surfaces here as a
    // `rawConfig` prop change. The component's `watch(rawConfig, ...)` must
    // push it into the (mocked) editor instance.
    await wrapper.setProps({ rawConfig: 'server = 2' });
    await nextTick();

    expect(setOptionsSpy).toHaveBeenCalledWith({ value: 'server = 2' });
  });

  it('propagates an editor edit back to the parent (child -> parent)', async () => {
    const wrapper = mount(ExpertTab, { props: { rawConfig: 'server = 1' } });
    await nextTick();

    expect(capturedUpdateCallback).toBeTypeOf('function');
    // Simulates the real prism-code-editor firing its 'update' event as the
    // user types -- the ORIGINAL code's editorInstance.on('update', ...)
    // callback directly assigned `localRawConfig.value = value`.
    capturedUpdateCallback!('server = 3');
    await nextTick();

    // defineModel's write-through: assigning `rawConfig.value` inside the
    // child must emit `update:rawConfig`, which is what actually propagates
    // back to ServerConfig.vue's `localRawConfig` via `v-model:rawConfig`.
    expect(wrapper.emitted('update:rawConfig')).toBeTruthy();
    expect(wrapper.emitted('update:rawConfig')![0]).toEqual(['server = 3']);
  });

  it('syncs the editor theme when the UI store dark-mode flag changes', async () => {
    const { useUIStore } = await import('../../../stores/ui');
    const wrapper = mount(ExpertTab, { props: { rawConfig: 'server = 1' } });
    await nextTick();
    setOptionsSpy.mockClear();

    const uiStore = useUIStore();
    uiStore.isDark = !uiStore.isDark;
    await nextTick();

    expect(setOptionsSpy).toHaveBeenCalledWith({
      theme: uiStore.isDark ? 'github-dark' : 'github-light',
    });
    expect(wrapper.exists()).toBe(true);
  });

  it('emits revert-requested when the header Revert button is clicked', async () => {
    const wrapper = mount(ExpertTab, { props: { rawConfig: 'server = 1' }, attachTo: document.body });
    await nextTick();

    findByText('Revert')?.click();
    await nextTick();

    expect(wrapper.emitted('revert-requested')).toBeTruthy();
    wrapper.unmount();
  });

  it('emits revert-requested when the footer Discard Changes button is clicked', async () => {
    const wrapper = mount(ExpertTab, { props: { rawConfig: 'server = 1' }, attachTo: document.body });
    await nextTick();

    findByText('Discard Changes')?.click();
    await nextTick();

    expect(wrapper.emitted('revert-requested')).toBeTruthy();
    wrapper.unmount();
  });
});
