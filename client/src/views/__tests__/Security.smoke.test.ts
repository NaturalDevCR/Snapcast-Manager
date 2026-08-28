import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import Security from '../Security.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useUIStore } from '../../stores/ui';

describe('Security.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Security, '/security');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders English copy by default (i18n)', async () => {
    const wrapper = await mountSmokeTest(Security, '/security');
    expect(wrapper.text()).toContain('Admin access and server backup.');
    expect(wrapper.text()).toContain('Change Administrator Password');
    expect(wrapper.text()).toContain('Download Backup');
    expect(wrapper.text()).toContain('Restore Instructions');
  });

  it('renders Spanish copy when useUIStore().locale is "es" (i18n)', async () => {
    const wrapper = await mountSmokeTest(Security, '/security');
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Acceso de administrador y respaldo del servidor.');
    expect(wrapper.text()).toContain('Cambiar Contraseña del Administrador');
    expect(wrapper.text()).toContain('Descargar Respaldo');
    expect(wrapper.text()).toContain('Instrucciones de Restauración');
  });
});
