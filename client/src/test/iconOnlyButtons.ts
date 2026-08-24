// Task 32 test helper: find every rendered <button> whose only visible
// content is an icon glyph (a `material-symbols-outlined` span, whose text
// content is the Material Symbols ligature name itself, e.g. "delete") with
// no other visible text -- i.e. buttons that need an aria-label because a
// screen reader would otherwise announce them as unnamed. Used by the
// smoke-test aria-label regression checks for the busiest views.
import type { VueWrapper } from '@vue/test-utils';

export function findIconOnlyButtons(wrapper: VueWrapper): HTMLButtonElement[] {
  const buttons = Array.from(wrapper.element.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.filter((button) => {
    const clone = button.cloneNode(true) as HTMLButtonElement;
    clone.querySelectorAll('.material-symbols-outlined, svg').forEach((el) => el.remove());
    return clone.textContent!.trim() === '';
  });
}
