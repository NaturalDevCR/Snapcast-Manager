import { describe, expect, it } from 'vitest';
import { mountSmokeTest } from '../../test/mountView';
import Setup from '../Setup.vue';
import { useUIStore } from '../../stores/ui';

describe('Setup.vue i18n', () => {
  it('renders English copy by default', async () => {
    const wrapper = await mountSmokeTest(Setup, '/setup');
    expect(wrapper.text()).toContain('Welcome to Snapcast Manager');
    expect(wrapper.text()).toContain('Create account');
  });

  it('renders Spanish copy when useUIStore().locale is "es"', async () => {
    const wrapper = await mountSmokeTest(Setup, '/setup');
    useUIStore().setLocale('es');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Bienvenido a Snapcast Manager');
    expect(wrapper.text()).toContain('Crear cuenta');
  });
});
