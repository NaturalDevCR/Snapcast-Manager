import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Onboarding from '../Onboarding.vue';
import { useOnboardingStore } from '../../stores/onboarding';
import { useSystemStore } from '../../stores/system';
import { usePipeSourcesStore } from '../../stores/pipeSources';
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
});
