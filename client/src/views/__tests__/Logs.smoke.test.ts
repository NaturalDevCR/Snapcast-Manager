import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import Logs from '../Logs.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useUIStore } from '../../stores/ui';

describe('Logs.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Logs, '/logs');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders English copy by default (i18n)', async () => {
    const wrapper = await mountSmokeTest(Logs, '/logs');
    expect(wrapper.text()).toContain('System Logs');
    expect(wrapper.text()).toContain('Real-time surveillance of your services.');
    expect(wrapper.text()).toContain('Sync Now');
    expect(wrapper.text()).toContain('Console Output');
  });

  it('renders Spanish copy when useUIStore().locale is "es" (i18n)', async () => {
    const wrapper = await mountSmokeTest(Logs, '/logs');
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Registros del Sistema');
    expect(wrapper.text()).toContain('Supervisión en tiempo real de tus servicios.');
    expect(wrapper.text()).toContain('Sincronizar Ahora');
    expect(wrapper.text()).toContain('Salida de Consola');
  });
});
