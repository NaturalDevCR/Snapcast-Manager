import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import Dashboard from '../Dashboard.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useSnapcastStore } from '../../stores/snapcast';
import { useEventSource } from '../../composables/useEventSource';
import { useOnboardingStore } from '../../stores/onboarding';
import { useSystemStore } from '../../stores/system';
import { useUIStore } from '../../stores/ui';
import { useHealthStore } from '../../stores/health';

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

  // --- i18n (Task 56) ----------------------------------------------------
  // Task 56 extracts every literal English string in this view (the
  // largest, most string-dense view in this plan's pilot scope) into the
  // `dashboard` i18n namespace, following the exact pattern Tasks 53-55
  // established for Login.vue/Setup.vue/Onboarding.vue. These tests prove
  // the extraction: default-English rendering stays byte-identical to the
  // pre-extraction hardcoded copy (so every test above keeps passing
  // unmodified), switching locale to "es" via useUIStore().setLocale()
  // re-renders the real Costa-Rica-Spanish translations, and a named
  // interpolation (the "new version available" banner) resolves correctly
  // in both locales.
  it('renders English copy by default across the header and service cards (i18n)', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    expect(wrapper.text()).toContain('System Dashboard');
    expect(wrapper.text()).toContain('Manage and monitor your Snapcast infrastructure.');
    expect(wrapper.text()).toContain('SYNC ALL');
    expect(wrapper.text()).toContain('Core System Services');
    // Default store state: no packages installed -- these "Install X"
    // buttons are the ones guaranteed to render without further store setup.
    expect(wrapper.text()).toContain('Install Snapserver');
    expect(wrapper.text()).toContain('Audio Plugins & Remotes');
    expect(wrapper.text()).toContain('Install FFmpeg');
    expect(wrapper.text()).toContain('Install AirPlay');
  });

  it('renders Spanish copy across the header and service cards when useUIStore().locale is "es" (i18n)', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Panel del Sistema');
    expect(wrapper.text()).toContain('Administra y monitorea tu infraestructura Snapcast.');
    expect(wrapper.text()).toContain('SINCRONIZAR TODO');
    expect(wrapper.text()).toContain('Servicios Principales del Sistema');
    expect(wrapper.text()).toContain('Instalar Snapserver');
    expect(wrapper.text()).toContain('Plugins de Audio y Controles Remotos');
    expect(wrapper.text()).toContain('Instalar FFmpeg');
    expect(wrapper.text()).toContain('Instalar AirPlay');
  });

  it('interpolates the installed package name into the "new version available" banner across locales (i18n)', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const systemStore = useSystemStore();
    systemStore.installedPackages.snapserver = true;
    systemStore.packageVersions.snapserver = '1.0.0';
    systemStore.availableVersions.snapserver = '1.2.3';
    await nextTick();
    expect(wrapper.text()).toContain('NEW VERSION: 1.2.3');

    useUIStore().setLocale('es');
    await nextTick();
    expect(wrapper.text()).toContain('NUEVA VERSIÓN: 1.2.3');
  });

  // --- Health panel (Task 58) --------------------------------------------
  // Task 58 adds a compact panel reading GET /api/health/detail (Task 57)
  // via the new `health` Pinia store. These tests mock `healthStore.detail`
  // directly (following this file's own established pattern of mutating
  // store state post-mount, e.g. the snapcastStore.status test above)
  // rather than the network layer, since the store's own fetch plumbing is
  // exercised separately by the refresh-button test below.
  it('renders the health panel reflecting a fully healthy detail response', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const healthStore = useHealthStore();
    healthStore.detail = {
      snapserver: { systemdActive: true, rpcConnected: true },
      config: { parseable: true },
      disk: { freeBytes: 5_000_000_000, freePercent: 42 },
      permissions: { snapshotsDirWritable: true },
    };
    await nextTick();

    expect(wrapper.text()).toContain('System Health');
    expect(wrapper.text()).toContain('Active');
    expect(wrapper.text()).toContain('Connected');
    expect(wrapper.text()).toContain('Parseable');
    expect(wrapper.text()).toContain('42% free');
    expect(wrapper.text()).toContain('Yes');
  });

  it('shows a degraded health state, including the config error message, when checks fail', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const healthStore = useHealthStore();
    healthStore.detail = {
      snapserver: { systemdActive: false, rpcConnected: false },
      config: { parseable: false, error: 'Unexpected token in snapserver.conf' },
      disk: { freeBytes: 100, freePercent: 1 },
      permissions: { snapshotsDirWritable: false },
    };
    await nextTick();

    expect(wrapper.text()).toContain('Inactive');
    expect(wrapper.text()).toContain('Disconnected');
    expect(wrapper.text()).toContain('Unexpected token in snapserver.conf');
    expect(wrapper.text()).toContain('No');
  });

  it('re-fetches health detail when the manual refresh button is clicked', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const healthStore = useHealthStore();
    const spy = vi.spyOn(healthStore, 'fetchHealthDetail').mockResolvedValue();

    const refreshButton = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Refresh health status');
    expect(refreshButton, 'expected a health-panel refresh button with an aria-label').toBeTruthy();

    await refreshButton!.trigger('click');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('renders Spanish copy for the health panel when locale is "es" (i18n)', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    const healthStore = useHealthStore();
    healthStore.detail = {
      snapserver: { systemdActive: true, rpcConnected: false },
      config: { parseable: false, error: 'boom' },
      disk: { freeBytes: 100, freePercent: 7 },
      permissions: { snapshotsDirWritable: false },
    };
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Salud del Sistema');
    expect(wrapper.text()).toContain('Activo');
    expect(wrapper.text()).toContain('Desconectado');
    expect(wrapper.text()).toContain('7% libre');
    expect(wrapper.text()).toContain('No');
  });
});
