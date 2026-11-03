import { describe, expect, it } from 'vitest';
import { mountSmokeTest } from '../../test/mountView';
import Login from '../Login.vue';
import { useUIStore } from '../../stores/ui';

describe('Login.vue i18n', () => {
  it('renders English copy by default', async () => {
    const wrapper = await mountSmokeTest(Login, '/login');
    expect(wrapper.text()).toContain('Sign In');
    expect(wrapper.text()).toContain('Sign in to manage your Snapcast system.');
  });

  it('renders Spanish copy when useUIStore().locale is "es"', async () => {
    const wrapper = await mountSmokeTest(Login, '/login');
    useUIStore().setLocale('es');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Iniciar sesión');
    expect(wrapper.text()).toContain('Inicia sesión para administrar tu sistema Snapcast.');
  });
});
