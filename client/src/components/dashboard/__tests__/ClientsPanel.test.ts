import { describe, expect, it } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { SnapcastClient } from '@shared/snapcast';
import ClientsPanel from '../ClientsPanel.vue';
import enDashboard from '../../../locales/en/dashboard.json';

function client(name: string, connected: boolean, ip = '::ffff:10.5.0.22'): SnapcastClient {
  return {
    id: name,
    connected,
    host: { name, ip },
    config: { name, volume: { percent: 40, muted: false } },
  } as SnapcastClient;
}

function mountPanel(clients: SnapcastClient[]) {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: { en: { dashboard: enDashboard } },
  });
  return mount(ClientsPanel, {
    props: { clients },
    global: { plugins: [i18n], stubs: { RouterLink: RouterLinkStub } },
  });
}

const many = [
  ...Array.from({ length: 6 }, (_, i) => client(`Pool ${i + 1}`, true)),
  ...Array.from({ length: 4 }, (_, i) => client(`Lounge ${i + 1}`, false, '::ffff:10.5.0.25')),
];

const names = (wrapper: ReturnType<typeof mountPanel>) =>
  wrapper.findAll('li').map((row) => row.find('span.truncate').text());

describe('ClientsPanel', () => {
  it('hides the filters for a short list', () => {
    const wrapper = mountPanel([client('Pool', true)]);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
  });

  it('lists online clients first, then by name', () => {
    const wrapper = mountPanel([
      client('Bar', false),
      client('Pool 10', true),
      client('Pool 2', true),
    ]);
    expect(names(wrapper)).toEqual(['Pool 2', 'Pool 10', 'Bar']);
  });

  it('filters by status and shows each status count', async () => {
    const wrapper = mountPanel(many);
    const radios = wrapper.findAll('[role="radio"]');
    expect(radios.map((r) => r.text())).toEqual(['All 10', 'Online 6', 'Offline 4']);

    await radios[2]!.trigger('click');

    expect(names(wrapper)).toEqual(['Lounge 1', 'Lounge 2', 'Lounge 3', 'Lounge 4']);
  });

  it('searches by name and by IP without the ::ffff: prefix', async () => {
    const wrapper = mountPanel(many);
    await wrapper.find('input').setValue('pool 3');
    expect(names(wrapper)).toEqual(['Pool 3']);

    await wrapper.find('input').setValue('10.5.0.25');
    expect(wrapper.findAll('li')).toHaveLength(4);
    expect(wrapper.text()).not.toContain('::ffff:');
  });

  it('explains an empty search result', async () => {
    const wrapper = mountPanel(many);
    await wrapper.find('input').setValue('nothing here');
    expect(wrapper.text()).toContain(enDashboard.clientsNoMatch);
  });
});
