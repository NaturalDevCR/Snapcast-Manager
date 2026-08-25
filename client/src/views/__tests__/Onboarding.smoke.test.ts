import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Onboarding from '../Onboarding.vue';
import { useOnboardingStore } from '../../stores/onboarding';
import { useSystemStore } from '../../stores/system';
import { usePipeSourcesStore } from '../../stores/pipeSources';
import { useSnapcastStore } from '../../stores/snapcast';
import { useUIStore } from '../../stores/ui';
import { mountSmokeTest } from '../../test/mountView';

describe('Onboarding.vue', () => {
  it('step 1 shows "Install Snapserver" when not installed, and calls systemStore.installPackage on click', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const systemStore = useSystemStore();
    onboardingStore.step = 1;
    systemStore.installedPackages.snapserver = false;
    const installSpy = vi.spyOn(systemStore, 'installPackage').mockResolvedValue(undefined as any);
    await nextTick();

    const installButton = wrapper.findAll('button').find(b => b.text().includes('Install Snapserver'));
    expect(installButton, 'expected an Install Snapserver button on step 1').toBeTruthy();
    await installButton!.trigger('click');
    expect(installSpy).toHaveBeenCalledWith('snapserver');
  });

  it('step 1 shows a confirmation and a Next control when already installed', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const systemStore = useSystemStore();
    onboardingStore.step = 1;
    systemStore.installedPackages.snapserver = true;
    await nextTick();

    expect(wrapper.text()).not.toContain('Install Snapserver');
    const nextButton = wrapper.findAll('button').find(b => b.text().includes('Next'));
    expect(nextButton, 'expected a Next control once snapserver is installed').toBeTruthy();
  });

  it('step 2 auto-opens AddEditPipeDialog and advances to step 3 when it emits saved', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const pipeSourcesStore = usePipeSourcesStore();
    onboardingStore.step = 2;
    pipeSourcesStore.pipes = [];
    const setStepSpy = vi.spyOn(onboardingStore, 'setStep').mockResolvedValue(undefined);
    await nextTick();
    await nextTick();

    // Dialog is Teleport(to="body")'d -- query document.body, same pattern
    // established by every extracted-modal test this session.
    expect(document.body.textContent).toContain('Add Pipe Source');

    const dialogComponent = wrapper.findComponent({ name: 'AddEditPipeDialog' });
    dialogComponent.vm.$emit('saved', { snapserverConfigChanged: true });
    await nextTick();

    expect(setStepSpy).toHaveBeenCalledWith(3);
  });

  it('step 2 skips the dialog and shows an already-satisfied state if pipes already exist', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const pipeSourcesStore = usePipeSourcesStore();
    onboardingStore.step = 2;
    pipeSourcesStore.pipes = [{ id: 'p1', name: 'Radio' } as any];
    await nextTick();

    expect(document.body.textContent).not.toContain('Add Pipe Source');
    expect(wrapper.text()).toContain('already have');
  });

  it('step 3 shows a waiting state when no group has a connected client', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const snapcastStore = useSnapcastStore();
    onboardingStore.step = 3;
    snapcastStore.status = { server: { version: '1.0' }, groups: [], streams: [] } as any;
    await nextTick();

    expect(wrapper.text().toLowerCase()).toContain('waiting for a client');
  });

  it('step 3 still shows the waiting state when a group exists but has zero connected clients', async () => {
    // Regression coverage for firstGroupWithClient's `g.clients.length > 0`
    // check (Onboarding.vue): a group existing at all is not sufficient --
    // it must actually have a connected client. Without this test, a
    // mutation of that check to `>= 0` (or removing it) would slip through
    // undetected, since the other waiting-state test only supplies
    // `groups: []` (no group objects at all).
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const snapcastStore = useSnapcastStore();
    onboardingStore.step = 3;
    snapcastStore.status = {
      server: { version: '1.0' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [], stream_id: '', muted: false }],
      streams: [],
    } as any;
    await nextTick();

    expect(wrapper.text().toLowerCase()).toContain('waiting for a client');
    expect(wrapper.findAll('button').find(b => b.text() === 'Choose a source')).toBeFalsy();
  });

  it('step 3 shows a zone-assignment Select once a group with a client exists, and completes onboarding on assignment', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const snapcastStore = useSnapcastStore();
    const setStepSpy = vi.spyOn(onboardingStore, 'setStep').mockResolvedValue(undefined);
    onboardingStore.step = 3;
    snapcastStore.status = {
      server: { version: '1.0' },
      groups: [{ id: 'g1', name: 'Living Room', clients: [{ id: 'c1' }], stream_id: '', muted: false }],
      streams: [{ id: 'a', status: 'idle', uri: { query: { name: 'Radio A' }, scheme: 'tcp' } }],
    } as any;
    const setGroupStreamSpy = vi.spyOn(snapcastStore, 'setGroupStream').mockResolvedValue(undefined);
    await nextTick();

    expect(wrapper.text().toLowerCase()).not.toContain('waiting for a client');

    // Bug found in the plan's own example test (docs/superpowers/plans/
    // 2026-08-25-onboarding-wizard.md, Task 4, Step 1): it locates the
    // zone Select's trigger via `.find('button').find(b => b.text().length
    // > 0)`, i.e. "the first button on the page with any text". That
    // matches Layout.vue's nav buttons ("menu", "dns Server", "speaker
    // Client", "apps Menu expand_more", "logout") and this view's own
    // "Skip for now" button, all of which render before the Select in DOM
    // order -- so it never actually clicks the Select at all, and the
    // subsequent `[role="option"]` lookup returns nothing, throwing on
    // `option!.trigger(...)`. Target the Select's own trigger by its
    // placeholder text instead, which is unique on the page.
    const selectButton = wrapper.findAll('button').find(b => b.text() === 'Choose a source');
    expect(selectButton, 'expected the zone Select trigger to be present').toBeTruthy();
    await selectButton!.trigger('click');
    const option = wrapper.findAll('[role="option"]').find(o => o.text().includes('Radio A'));
    await option!.trigger('click');
    await nextTick();

    expect(setGroupStreamSpy).toHaveBeenCalledWith('g1', 'a');
    expect(setStepSpy).toHaveBeenCalledWith(3); // marks complete; adjust to whatever "done" sentinel Step 3 implementation actually uses
  });

  // --- i18n (Task 55) ---------------------------------------------------
  // Task 55 extracts every literal English string in this view into the
  // `onboarding` i18n namespace. These two tests prove the extraction:
  // default-English rendering stays byte-identical to the pre-extraction
  // hardcoded copy (so all the tests above keep passing unmodified), and
  // switching locale to "es" via useUIStore().setLocale() re-renders the
  // real Costa-Rica-Spanish translations -- including step 3's dynamic
  // zone-name interpolation, both with a real group name and via the
  // `zoneFallbackName` fallback when a group has no name.
  it('renders English copy by default across all 3 steps (i18n)', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const systemStore = useSystemStore();
    const snapcastStore = useSnapcastStore();

    onboardingStore.step = 1;
    systemStore.installedPackages.snapserver = false;
    await nextTick();
    expect(wrapper.text()).toContain('1. Set Up Snapserver');
    expect(wrapper.text()).toContain('Skip for now');

    onboardingStore.step = 2;
    await nextTick();
    expect(wrapper.text()).toContain('2. Add your first source');

    onboardingStore.step = 3;
    snapcastStore.status = {
      server: { version: '1.0' },
      groups: [{ id: 'g1abcd', name: '', clients: [{ id: 'c1' }], stream_id: '', muted: false }],
      streams: [],
    } as any;
    await nextTick();
    expect(wrapper.text()).toContain('3. Assign your first zone');
    // Dynamic zone-name interpolation via the `zoneFallbackName` key when
    // the group has no name (matches the original `'Zone ' + id.slice(0,4)`
    // string-concatenation behavior it replaces).
    expect(wrapper.text()).toContain('Zone g1ab is ready');
  });

  it('renders Spanish copy across all 3 steps when useUIStore().locale is "es" (i18n)', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const systemStore = useSystemStore();
    const snapcastStore = useSnapcastStore();
    useUIStore().setLocale('es');

    onboardingStore.step = 1;
    systemStore.installedPackages.snapserver = false;
    await nextTick();
    expect(wrapper.text()).toContain('1. Configurar Snapserver');
    expect(wrapper.text()).toContain('Omitir por ahora');

    onboardingStore.step = 2;
    await nextTick();
    expect(wrapper.text()).toContain('2. Agrega tu primera fuente');

    onboardingStore.step = 3;
    snapcastStore.status = {
      server: { version: '1.0' },
      groups: [{ id: 'g1', name: 'Sala', clients: [{ id: 'c1' }], stream_id: '', muted: false }],
      streams: [],
    } as any;
    await nextTick();
    expect(wrapper.text()).toContain('3. Asigna tu primera zona');
    expect(wrapper.text()).toContain('Sala está lista');
  });
});
