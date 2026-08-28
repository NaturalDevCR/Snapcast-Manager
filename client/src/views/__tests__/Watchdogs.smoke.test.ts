import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import Watchdogs from '../Watchdogs.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useWatchdogStore } from '../../stores/watchdog';
import { useUIStore } from '../../stores/ui';

describe('Watchdogs.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders Spanish copy when locale is switched to "es"', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    useWatchdogStore().watchdogs = [];
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Aún no hay watchdogs configurados');
    expect(wrapper.text()).toContain('Agrega un watchdog para supervisar las conexiones de fuentes TCP Server en tiempo real.');
  });
});
