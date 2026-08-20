import { describe, expect, it } from 'vitest';
import { DOMWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ConfirmDestructive from '../ConfirmDestructive.vue';

// ConfirmDestructive is built on Modal, whose @headlessui/vue Dialog
// teleports its rendered markup into `document.body`, outside the mounted
// wrapper's own DOM subtree -- see Modal.test.ts for the full explanation.
// All DOM lookups below go through this `body` DOMWrapper; `wrapper` itself
// is still used for setProps/emitted().
const body = () => new DOMWrapper(document.body);

const baseProps = {
  modelValue: true,
  title: 'Delete pipe source',
  message: 'This will permanently remove the pipe source.',
  entityName: 'living-room-speaker',
};

function findDeleteButton() {
  return body()
    .findAll('button')
    .find((b) => b.text() === 'Delete');
}

function findCancelButton() {
  return body()
    .findAll('button')
    .find((b) => b.text() === 'Cancel');
}

describe('ConfirmDestructive.vue — the critical safety test', () => {
  it('starts with the confirm button disabled', async () => {
    mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const deleteButton = findDeleteButton();
    expect(deleteButton).toBeTruthy();
    expect(deleteButton?.attributes('disabled')).toBeDefined();
  });

  it('stays disabled on a partial / near-match / wrong-case typed name', async () => {
    mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');

    for (const wrongValue of [
      'living-room-speake', // partial
      'living-room-speaker ', // trailing whitespace
      ' living-room-speaker', // leading whitespace
      'LIVING-ROOM-SPEAKER', // wrong case
      'living-room-speakerX', // extra char
      '',
    ]) {
      await input.setValue(wrongValue);
      const deleteButton = findDeleteButton();
      expect(deleteButton?.attributes('disabled'), `expected disabled for "${wrongValue}"`).toBeDefined();
    }
  });

  it('enables the confirm button ONLY on an exact match', async () => {
    mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('living-room-speaker');
    expect(findDeleteButton()?.attributes('disabled')).toBeUndefined();
  });

  it('emits confirm exactly once when the enabled confirm button is clicked', async () => {
    const wrapper = mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('living-room-speaker');
    await findDeleteButton()?.trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
  });

  it('never emits confirm while the typed value does not match, even if click is forced', async () => {
    const wrapper = mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('not-a-match');
    // Force a click event even though the button is natively disabled, to
    // exercise the handler's own internal guard (defense in depth) rather
    // than relying solely on the browser's disabled-button click suppression.
    await findDeleteButton()?.trigger('click');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it('pressing Enter in the input does not bypass the match check or emit confirm', async () => {
    const wrapper = mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('not-a-match');
    await input.trigger('keyup.enter');
    expect(wrapper.emitted('confirm')).toBeFalsy();

    // Even with a correct match typed, Enter alone (no explicit button
    // click) must not emit confirm -- only the button click handler may.
    await input.setValue('living-room-speaker');
    await input.trigger('keyup.enter');
    expect(wrapper.emitted('confirm')).toBeFalsy();
  });

  it("closing the modal via its own close button (Modal's own close path) emits cancel, never confirm", async () => {
    const wrapper = mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('living-room-speaker'); // matches, but dialog is dismissed, not confirmed
    const closeButton = body().find('button[aria-label="Close"]');
    await closeButton.trigger('click');
    expect(wrapper.emitted('confirm')).toBeFalsy();
    expect(wrapper.emitted('cancel')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('emits update:modelValue(false) and cancel, never confirm, on Escape', async () => {
    const wrapper = mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('living-room-speaker');
    await body().trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(wrapper.emitted('confirm')).toBeFalsy();
    expect(wrapper.emitted('cancel')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('clicking Cancel emits cancel and update:modelValue(false), never confirm', async () => {
    const wrapper = mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    const input = body().find('input');
    await input.setValue('living-room-speaker');
    await findCancelButton()?.trigger('click');
    expect(wrapper.emitted('confirm')).toBeFalsy();
    expect(wrapper.emitted('cancel')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
  });

  it('resets the typed text when reopened, so a stale match does not carry over', async () => {
    const wrapper = mount(ConfirmDestructive, {
      props: { ...baseProps, modelValue: true },
    });
    await nextTick();
    let input = body().find('input');
    await input.setValue('living-room-speaker');
    expect(findDeleteButton()?.attributes('disabled')).toBeUndefined();

    await wrapper.setProps({ modelValue: false });
    await nextTick();
    await wrapper.setProps({ modelValue: true });
    await nextTick();

    expect(findDeleteButton()?.attributes('disabled')).toBeDefined();
    input = body().find('input');
    expect((input.element as HTMLInputElement).value).toBe('');
  });

  it('renders the entity name so the user knows what to type', async () => {
    mount(ConfirmDestructive, { props: baseProps });
    await nextTick();
    expect(body().text()).toContain('living-room-speaker');
  });

  it('supports a custom confirmLabel', async () => {
    mount(ConfirmDestructive, {
      props: { ...baseProps, confirmLabel: 'Uninstall' },
    });
    await nextTick();
    const buttons = body().findAll('button');
    expect(buttons.some((b) => b.text() === 'Uninstall')).toBe(true);
    expect(buttons.some((b) => b.text() === 'Delete')).toBe(false);
  });
});
