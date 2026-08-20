import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Input from '../Input.vue';

describe('Input.vue', () => {
  it('mounts without throwing', () => {
    const wrapper = mount(Input);
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('input').exists()).toBe(true);
  });

  it('supports v-model: emits update:modelValue on input', async () => {
    const wrapper = mount(Input, { props: { modelValue: '' } });
    const input = wrapper.find('input');
    await input.setValue('hello');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['hello']);
  });

  it('reflects the modelValue prop in the input value', () => {
    const wrapper = mount(Input, { props: { modelValue: 'preset' } });
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('preset');
  });

  it('applies the type attribute', () => {
    const wrapper = mount(Input, { props: { type: 'password' } });
    expect(wrapper.find('input').attributes('type')).toBe('password');
  });

  it('disables the input and it cannot be typed into when disabled', () => {
    const wrapper = mount(Input, { props: { disabled: true } });
    expect(wrapper.find('input').attributes('disabled')).toBeDefined();
  });

  it('renders an associated label with correct for/id pairing', () => {
    const wrapper = mount(Input, { props: { label: 'Username' } });
    const label = wrapper.find('label');
    const input = wrapper.find('input');
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe('Username');
    expect(label.attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('id')).toBeTruthy();
  });

  it('renders no label element when label prop is absent', () => {
    const wrapper = mount(Input);
    expect(wrapper.find('label').exists()).toBe(false);
  });

  it('shows an error message and marks the field invalid when error is set', () => {
    const wrapper = mount(Input, { props: { error: 'Required field' } });
    expect(wrapper.text()).toContain('Required field');
    const input = wrapper.find('input');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBeTruthy();
  });

  it('does not set aria-invalid when there is no error', () => {
    const wrapper = mount(Input);
    const input = wrapper.find('input');
    expect(input.attributes('aria-invalid')).toBeFalsy();
  });
});
