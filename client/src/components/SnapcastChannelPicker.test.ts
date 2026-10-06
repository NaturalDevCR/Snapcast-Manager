import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import SnapcastChannelPicker from './SnapcastChannelPicker.vue';
import { useSystemStore } from '../stores/system';
import { fetchApi } from '../utils/api';
import enCommon from '../locales/en/common.json';

vi.mock('../utils/api', () => ({ fetchApi: vi.fn() }));
const tag = 'v0.35.0-naturaldevcr.beta.1';
async function setup(channel = 'official', releases: any[] = []) {
  const pinia = createPinia();
  setActivePinia(pinia);
  vi.mocked(fetchApi).mockImplementation(async (url: string) => {
    if (url === '/system/snapcast-channels') return { snapclient: { channel } };
    if (url.includes('snapcast-releases')) return { releases };
    return {};
  });
  const wrapper = mount(SnapcastChannelPicker, { props: { pkg: 'snapclient' }, global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: { common: enCommon } } })] } });
  await flushPromises();
  return { wrapper, system: useSystemStore() };
}

describe('Snapcast installation channels', () => {
  it('defaults to official without querying beta releases', async () => {
    const { wrapper } = await setup();
    expect(wrapper.find('select').element.value).toBe('official');
    expect(vi.mocked(fetchApi).mock.calls.some(([url]) => url.includes('snapcast-releases'))).toBe(false);
  });
  it('shows release notes and pins a selected beta', async () => {
    const { wrapper } = await setup('beta', [{ tag, name: 'Beta 1', notes: 'ALSA recovery' }]);
    expect(wrapper.text()).toContain('ALSA recovery');
    await wrapper.findAll('select')[1]!.setValue(tag);
    await flushPromises();
    expect(fetchApi).toHaveBeenCalledWith('/system/snapcast-channels/snapclient', expect.objectContaining({ body: JSON.stringify({ channel: 'beta', tag }) }));
  });
  it('switches to official and installs without clearing configuration', async () => {
    const { wrapper, system } = await setup('beta', [{ tag, notes: 'ALSA recovery' }]);
    system.installedPackages.snapclient = true;
    const update = vi.spyOn(system, 'updatePackage').mockResolvedValue();
    await wrapper.find('select').setValue('official');
    await flushPromises();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(update).toHaveBeenCalledWith('snapclient', false);
  });
  it('does not offer installation when no compatible beta exists', async () => {
    const { wrapper } = await setup('beta');
    expect(wrapper.text()).toContain('No beta packages available');
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });
});
