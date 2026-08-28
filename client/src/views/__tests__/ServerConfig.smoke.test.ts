import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import ServerConfig from '../ServerConfig.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useUIStore } from '../../stores/ui';

describe('ServerConfig.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(ServerConfig, '/server');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders Spanish copy when locale is switched to "es"', async () => {
    const wrapper = await mountSmokeTest(ServerConfig, '/server');
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Estándar');
    expect(wrapper.text()).toContain('Editor visual');
    expect(wrapper.text()).toContain('Experto');
    expect(wrapper.text()).toContain('Archivo INI en bruto');
    expect(wrapper.text()).toContain('Instantáneas');
    expect(wrapper.text()).toContain('Guardar configuración');
  });
});
