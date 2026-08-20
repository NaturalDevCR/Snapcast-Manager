import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Toggle from '../Toggle.vue';

describe('Toggle.vue', () => {
  it('mounts without throwing', () => {
    const wrapper = mount(Toggle, { props: { modelValue: false } });
    expect(wrapper.exists()).toBe(true);
  });

  it('exposes role="switch" and aria-checked reflecting modelValue', () => {
    const wrapperOff = mount(Toggle, { props: { modelValue: false } });
    expect(wrapperOff.find('[role="switch"]').attributes('aria-checked')).toBe('false');

    const wrapperOn = mount(Toggle, { props: { modelValue: true } });
    expect(wrapperOn.find('[role="switch"]').attributes('aria-checked')).toBe('true');
  });

  it('updates modelValue via v-model when clicked', async () => {
    const wrapper = mount(Toggle, { props: { modelValue: false } });
    await wrapper.find('[role="switch"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('does not toggle when disabled', async () => {
    const wrapper = mount(Toggle, { props: { modelValue: false, disabled: true } });
    await wrapper.find('[role="switch"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeFalsy();
  });

  it('renders the optional label text', () => {
    const wrapper = mount(Toggle, { props: { modelValue: false, label: 'Enable feature' } });
    expect(wrapper.text()).toContain('Enable feature');
  });
});
