import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Badge from '../Badge.vue';

describe('Badge.vue', () => {
  it('mounts without throwing and renders slot content', () => {
    const wrapper = mount(Badge, { slots: { default: 'Active' } });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain('Active');
  });

  it.each(['success', 'warning', 'danger', 'neutral', 'brand'] as const)(
    'renders the %s variant without throwing',
    (variant) => {
      const wrapper = mount(Badge, { props: { variant }, slots: { default: 'x' } });
      expect(wrapper.exists()).toBe(true);
    },
  );

  it.each(['sm', 'md'] as const)('renders the %s size without throwing', (size) => {
    const wrapper = mount(Badge, { props: { size }, slots: { default: 'x' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('defaults to the neutral variant', () => {
    const wrapper = mount(Badge, { slots: { default: 'x' } });
    expect(wrapper.exists()).toBe(true);
  });
});
