import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Select from '../Select.vue';

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
];

describe('Select.vue', () => {
  it('mounts without throwing', () => {
    const wrapper = mount(Select, { props: { options, modelValue: 'a' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('shows the placeholder when nothing is selected', () => {
    const wrapper = mount(Select, { props: { options, placeholder: 'Choose one' } });
    expect(wrapper.text()).toContain('Choose one');
  });

  it('shows the selected option label', () => {
    const wrapper = mount(Select, { props: { options, modelValue: 'b' } });
    expect(wrapper.text()).toContain('Option B');
  });

  it('exposes a listbox button with aria-haspopup', () => {
    const wrapper = mount(Select, { props: { options, modelValue: 'a' } });
    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-haspopup')).toBeTruthy();
  });

  it('updates modelValue via v-model when an option is picked', async () => {
    const wrapper = mount(Select, { props: { options, modelValue: 'a' } });
    await wrapper.find('button').trigger('click');
    const optionEls = wrapper.findAll('[role="option"]');
    expect(optionEls.length).toBe(options.length);
    const thirdOption = optionEls[options.length - 1];
    expect(thirdOption).toBeTruthy();
    await thirdOption?.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['c']);
  });

  it('disables the trigger button when disabled', () => {
    const wrapper = mount(Select, { props: { options, disabled: true } });
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });
});
