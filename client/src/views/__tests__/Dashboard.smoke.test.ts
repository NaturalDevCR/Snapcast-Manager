import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Dashboard from '../Dashboard.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useSnapcastStore } from '../../stores/snapcast';
import { useEventSource } from '../../composables/useEventSource';
import { useOnboardingStore } from '../../stores/onboarding';

describe('Dashboard.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    expect(wrapper.exists()).toBe(true);
  });

  // Task 29: polling is replaced by the app-wide SSE connection (Task 28) --
  // this view must not create its own timer. The composable's own internal
  // reconnect timers don't count since useEventSource() isn't connect()-ed
  // by this view (App.vue owns that) and no EventSource is ever opened here.
  it('does not create its own polling interval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    await mountSmokeTest(Dashboard, '/');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('reactively reflects snapcastStore.status updates, however they arrive (SSE push or the initial fetch)', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const snapcastStore = useSnapcastStore();

    // Simulate what useEventSource()'s applySnapcastUpdate() does on a
    // 'snapcast' SSE event: replace store.status with a fresh object.
    snapcastStore.status = {
      server: { version: '1.2.3' },
      groups: [],
      streams: [
        { id: 's1', status: 'playing', uri: { query: { name: 'Living Room Radio' }, scheme: 'tcp' } },
      ],
    };
    await nextTick();

    expect(wrapper.text()).toContain('Living Room Radio');
  });

  it('renders a live/reconnecting SSE status indicator that reflects the composable\'s connection status', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const sse = useEventSource();

    sse.status.value = 'connected';
    await nextTick();
    expect(wrapper.text()).toMatch(/live/i);

    sse.status.value = 'reconnecting';
    await nextTick();
    expect(wrapper.text()).toMatch(/reconnecting/i);
  });

  it('shows a resume-onboarding banner when incomplete and not dismissed', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const onboardingStore = useOnboardingStore();
    onboardingStore.step = 2;
    onboardingStore.dismissed = false;
    await nextTick();

    expect(wrapper.text().toLowerCase()).toContain('finish setting up');
    const link = wrapper.findAll('a, router-link-stub').find(el => el.attributes('to') === '/onboarding' || el.attributes('href') === '/onboarding');
    expect(link, 'expected a link/route to /onboarding').toBeTruthy();
  });

  it('hides the banner once onboarding is complete or dismissed', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const onboardingStore = useOnboardingStore();
    onboardingStore.step = 3;
    onboardingStore.dismissed = false;
    await nextTick();
    expect(wrapper.text().toLowerCase()).not.toContain('finish setting up');

    onboardingStore.step = 1;
    onboardingStore.dismissed = true;
    await nextTick();
    expect(wrapper.text().toLowerCase()).not.toContain('finish setting up');
  });
});
