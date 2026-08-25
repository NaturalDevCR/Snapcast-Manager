// Regression guard for a cross-test locale leak in `mountSmokeTest()`
// (`client/src/test/mountView.ts`) found in Task 53's independent review
// (`.superpowers/sdd/task-53-review.md`, Finding 1, HIGH severity).
//
// `useUIStore()`'s `locale` ref is seeded from, and `setLocale()` mutates,
// the REAL module-global `i18n.global.locale.value` singleton exported by
// `client/src/i18n.ts` (see `stores/ui.ts`). Vitest isolates modules per
// FILE, not per test, so once any test in a file calls
// `useUIStore().setLocale('es')`, that global singleton stays polluted at
// 'es' for the rest of the file's run -- and `mountSmokeTest()`'s
// locale-mirroring watcher faithfully mirrors that polluted global onto
// every subsequently-mounted component's own `testI18n` instance, silently
// breaking `mountSmokeTest()`'s documented "always defaults to 'en'"
// contract for any later, completely unrelated test in the same file.
//
// This test is structurally identical to the reviewer's own repro: one
// test switches locale to 'es', then a later, unrelated test in the SAME
// file does a fresh mount and asserts default English.
import { describe, expect, it } from 'vitest';
import { mountSmokeTest } from '../mountView';
import Login from '../../views/Login.vue';
import { useUIStore } from '../../stores/ui';

describe('mountSmokeTest() locale isolation across tests in the same file', () => {
  it('an earlier test switching locale to "es"', async () => {
    const wrapper = await mountSmokeTest(Login, '/login');
    useUIStore().setLocale('es');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Iniciar Sesión');
  });

  it('does not leak into a later, unrelated fresh mount in the same file', async () => {
    // No setLocale() call here at all -- this mount must still default to
    // English regardless of what the previous test did to the real i18n
    // singleton.
    const wrapper = await mountSmokeTest(Login, '/login');
    expect(wrapper.text()).toContain('Sign In');
    expect(wrapper.text()).not.toContain('Iniciar Sesión');
  });
});
