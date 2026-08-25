import { describe, expect, it } from 'vitest';
import { mountSmokeTest } from '../../test/mountView';
import Layout from '../Layout.vue';
import { useUIStore } from '../../stores/ui';

describe('Layout.vue language switcher', () => {
  it('clicking the ES toggle switches useUIStore().locale to "es"', async () => {
    const wrapper = await mountSmokeTest(Layout, '/');
    const uiStore = useUIStore();
    expect(uiStore.locale).toBe('en');

    const esButton = wrapper.findAll('button').find(b => b.text().trim() === 'ES');
    expect(esButton, 'expected an ES toggle button in the nav bar').toBeTruthy();
    await esButton!.trigger('click');

    expect(uiStore.locale).toBe('es');
  });

  it('the EN toggle is disabled/inert while already on "en" (or: clicking it while already "en" is a no-op)', async () => {
    const wrapper = await mountSmokeTest(Layout, '/');
    const uiStore = useUIStore();
    const enButton = wrapper.findAll('button').find(b => b.text().trim() === 'EN');
    expect(enButton, 'expected an EN toggle button in the nav bar').toBeTruthy();
    await enButton!.trigger('click');
    expect(uiStore.locale).toBe('en');
  });
});
