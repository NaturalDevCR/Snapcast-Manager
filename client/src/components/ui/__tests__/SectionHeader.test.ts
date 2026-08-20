import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SectionHeader from '../SectionHeader.vue';

describe('SectionHeader.vue', () => {
  it('mounts without throwing', () => {
    const wrapper = mount(SectionHeader, { props: { title: 'Core System Services' } });
    expect(wrapper.exists()).toBe(true);
  });

  it('renders the title', () => {
    const wrapper = mount(SectionHeader, { props: { title: 'Core System Services' } });
    expect(wrapper.text()).toContain('Core System Services');
  });

  it('renders the optional eyebrow', () => {
    const wrapper = mount(SectionHeader, {
      props: { title: 'Streams', eyebrow: 'Live Infrastructure' },
    });
    expect(wrapper.text()).toContain('Live Infrastructure');
  });

  it('renders the optional description', () => {
    const wrapper = mount(SectionHeader, {
      props: { title: 'Streams', description: 'Configured audio routes.' },
    });
    expect(wrapper.text()).toContain('Configured audio routes.');
  });

  it('omits eyebrow and description when not provided', () => {
    const wrapper = mount(SectionHeader, { props: { title: 'Streams' } });
    expect(wrapper.text().trim()).toBe('Streams');
  });

  it('renders the action slot when provided', () => {
    const wrapper = mount(SectionHeader, {
      props: { title: 'Streams' },
      slots: { action: '<button>Add stream</button>' },
    });
    expect(wrapper.text()).toContain('Add stream');
  });
});
