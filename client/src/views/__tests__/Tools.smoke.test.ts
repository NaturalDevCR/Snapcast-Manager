import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import Tools from '../Tools.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useUIStore } from '../../stores/ui';

describe('Tools.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Tools, '/tools');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders Spanish copy when locale is switched to "es"', async () => {
    const wrapper = await mountSmokeTest(Tools, '/tools');
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Herramientas del Sistema');
    expect(wrapper.text()).toContain('Edita crontab, scripts y archivos de configuración de servicios.');
    expect(wrapper.text()).toContain('Editor de Crontab');
    expect(wrapper.text()).toContain('Guardar');
    expect(wrapper.text()).toContain('Copias de Seguridad');
    expect(wrapper.text()).toContain('Recargar');
  });
});
