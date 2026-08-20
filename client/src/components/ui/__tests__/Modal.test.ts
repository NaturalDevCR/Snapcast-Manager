import { describe, expect, it } from 'vitest';
import { DOMWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Modal from '../Modal.vue';

// @headlessui/vue's Dialog teleports its rendered markup into a real
// `document.body` node (`#headlessui-portal-root`), outside the mounted
// wrapper's own DOM subtree -- so `wrapper.text()`/`wrapper.find(...)` (which
// only look inside the wrapper's root element) can't see it. Assertions on
// rendered content go through this `body` DOMWrapper instead; `wrapper`
// itself is still used for props/setProps/emitted().
const body = () => new DOMWrapper(document.body);

describe('Modal.vue', () => {
  it('does not render its content into the document when modelValue is false', () => {
    mount(Modal, {
      props: { modelValue: false },
      slots: { default: 'Body content' },
    });
    expect(document.body.textContent).not.toContain('Body content');
  });

  it('renders its content when modelValue is true', async () => {
    mount(Modal, {
      props: { modelValue: true },
      slots: { default: 'Body content' },
    });
    await nextTick();
    expect(body().text()).toContain('Body content');
  });

  it('renders the optional title', async () => {
    mount(Modal, {
      props: { modelValue: true, title: 'My Modal Title' },
    });
    await nextTick();
    expect(body().text()).toContain('My Modal Title');
  });

  it('renders the footer slot when provided', async () => {
    mount(Modal, {
      props: { modelValue: true },
      slots: { footer: '<button>Footer action</button>' },
    });
    await nextTick();
    expect(body().text()).toContain('Footer action');
  });

  it('emits update:modelValue(false) when the close button is clicked', async () => {
    const wrapper = mount(Modal, {
      props: { modelValue: true, title: 'Closeable' },
    });
    await nextTick();
    const closeButton = body().find('button[aria-label="Close"]');
    expect(closeButton.exists()).toBe(true);
    await closeButton.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('emits update:modelValue(false) on Escape keydown', async () => {
    const wrapper = mount(Modal, {
      props: { modelValue: true, title: 'Escapable' },
    });
    await nextTick();
    await body().trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it.each(['sm', 'md', 'lg'] as const)('renders the %s size without throwing', async (size) => {
    const wrapper = mount(Modal, { props: { modelValue: true, size } });
    await nextTick();
    expect(wrapper.exists()).toBe(true);
  });
});
