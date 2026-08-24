import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Button from '../Button.vue';

describe('Button.vue', () => {
  it('mounts without throwing and renders slot content', () => {
    const wrapper = mount(Button, { slots: { default: 'Click me' } });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain('Click me');
  });

  it('renders a real <button> element', () => {
    const wrapper = mount(Button);
    expect(wrapper.element.tagName).toBe('BUTTON');
  });

  it('defaults to type="button"', () => {
    const wrapper = mount(Button);
    expect(wrapper.attributes('type')).toBe('button');
  });

  it('applies the native type attribute when passed', () => {
    const wrapper = mount(Button, { props: { type: 'submit' } });
    expect(wrapper.attributes('type')).toBe('submit');
  });

  it('emits a click event when enabled', async () => {
    const wrapper = mount(Button);
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toBeTruthy();
  });

  it('disables the button and blocks clicks when disabled', async () => {
    const wrapper = mount(Button, { props: { disabled: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toBeFalsy();
  });

  it('shows a spinner and disables the button when loading', () => {
    const wrapper = mount(Button, { props: { loading: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.find('.animate-spin').exists()).toBe(true);
  });

  it('does not emit click while loading', async () => {
    const wrapper = mount(Button, { props: { loading: true } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toBeFalsy();
  });

  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)(
    'renders the %s variant without throwing',
    (variant) => {
      const wrapper = mount(Button, { props: { variant } });
      expect(wrapper.exists()).toBe(true);
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renders the %s size without throwing', (size) => {
    const wrapper = mount(Button, { props: { size } });
    expect(wrapper.exists()).toBe(true);
  });

  // Task 32: Button.vue is a single-root <button> wrapper with no declared
  // `aria-label` prop and no `inheritAttrs: false`, so Vue's automatic
  // attribute fallthrough should forward a caller-supplied aria-label onto
  // the real <button> element untouched -- this guards that behavior for
  // icon-only usages of this component (e.g. an icon-only Button with no
  // slot text) so a future refactor can't silently swallow it.
  it('forwards a caller-supplied aria-label onto the underlying <button>', () => {
    const wrapper = mount(Button, {
      attrs: { 'aria-label': 'Delete pipe source' },
    });
    expect(wrapper.attributes('aria-label')).toBe('Delete pipe source');
  });
});
