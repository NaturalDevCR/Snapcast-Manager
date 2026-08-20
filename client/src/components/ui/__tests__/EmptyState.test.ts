import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyState from '../EmptyState.vue';

describe('EmptyState.vue', () => {
  it('mounts without throwing', () => {
    const wrapper = mount(EmptyState, { props: { icon: 'sensors', title: 'No pipe sources' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('renders the title', () => {
    const wrapper = mount(EmptyState, { props: { icon: 'sensors', title: 'No pipe sources configured' } });
    expect(wrapper.text()).toContain('No pipe sources configured');
  });

  it('renders the icon glyph name via a material-symbols-outlined element', () => {
    const wrapper = mount(EmptyState, { props: { icon: 'sensors', title: 'Empty' } });
    const icon = wrapper.find('.material-symbols-outlined');
    expect(icon.exists()).toBe(true);
    expect(icon.text()).toBe('sensors');
  });

  it('renders the optional description', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'sensors', title: 'Empty', description: 'Add one to get started.' },
    });
    expect(wrapper.text()).toContain('Add one to get started.');
  });

  it('omits the description when not provided', () => {
    const wrapper = mount(EmptyState, { props: { icon: 'sensors', title: 'Empty' } });
    expect(wrapper.findAll('p').length).toBe(0);
  });

  it('renders the action slot when provided', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: 'sensors', title: 'Empty' },
      slots: { action: '<button>Add your first source</button>' },
    });
    expect(wrapper.text()).toContain('Add your first source');
  });
});
