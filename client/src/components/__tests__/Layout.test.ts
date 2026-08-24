import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import Layout from '../Layout.vue';
import { mountSmokeTest } from '../../test/mountView';
import { findIconOnlyButtons } from '../../test/iconOnlyButtons';

// Task 32: Layout.vue renders on every server-mode page (it wraps every
// view's content), so its icon-only buttons -- the mobile burger toggle and
// the desktop/mobile sign-out buttons -- are the single most-seen unlabeled
// controls in the app before this task. The mobile drawer's own close
// button only exists once the drawer is open, so this opens it first to
// cover that one too.
describe('Layout.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Layout, '/');
    expect(wrapper.exists()).toBe(true);
  });

  it('gives every icon-only button a non-empty aria-label, collapsed and with the mobile drawer open', async () => {
    const wrapper = await mountSmokeTest(Layout, '/');

    let iconOnlyButtons = findIconOnlyButtons(wrapper);
    expect(iconOnlyButtons.length).toBeGreaterThan(0);
    for (const button of iconOnlyButtons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }

    // Open the mobile nav drawer (the burger button) to render its own
    // close button and mobile sign-out button too.
    const burger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Open menu');
    expect(burger, 'expected to find the mobile menu burger button').toBeTruthy();
    await burger!.trigger('click');
    await nextTick();

    iconOnlyButtons = findIconOnlyButtons(wrapper);
    expect(iconOnlyButtons.length).toBeGreaterThan(0);
    for (const button of iconOnlyButtons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
