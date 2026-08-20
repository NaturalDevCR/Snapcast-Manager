import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Skeleton from '../Skeleton.vue';

describe('Skeleton.vue', () => {
  it('mounts without throwing', () => {
    const wrapper = mount(Skeleton);
    expect(wrapper.exists()).toBe(true);
  });

  it('applies the animate-pulse class', () => {
    const wrapper = mount(Skeleton);
    expect(wrapper.classes()).toContain('animate-pulse');
  });

  it('defaults to the text variant', () => {
    const wrapper = mount(Skeleton);
    expect(wrapper.classes()).toContain('rounded-md');
  });

  it('renders a fully round shape for the circle variant', () => {
    const wrapper = mount(Skeleton, { props: { variant: 'circle' } });
    expect(wrapper.classes()).toContain('rounded-full');
  });

  it('renders a rectangular shape for the rect variant', () => {
    const wrapper = mount(Skeleton, { props: { variant: 'rect' } });
    expect(wrapper.classes()).toContain('rounded-xl');
  });

  it('applies a custom width and height as inline styles', () => {
    const wrapper = mount(Skeleton, { props: { width: 120, height: '2rem' } });
    const style = wrapper.attributes('style') ?? '';
    expect(style).toContain('width: 120px');
    expect(style).toContain('height: 2rem');
  });

  it('is hidden from assistive tech since it carries no content', () => {
    const wrapper = mount(Skeleton);
    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });
});
