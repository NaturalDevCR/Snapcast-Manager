// Shared Vitest setup for client smoke tests.
//
// Every view mounts against real Pinia stores (see mountView.ts), and most
// stores call `fetchApi` -> `fetch` from an `onMounted` hook. A smoke test
// doesn't need real data, just a `fetch` that resolves harmlessly instead of
// rejecting (which would otherwise surface as unhandled promise rejection
// noise in the test run, or throw() inside the store's fetchApi awaits).
//
// Stubbed once here, reset between tests so no state leaks across files.
import { afterEach, beforeEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

// Auto-unmount every mounted wrapper after each test. This was a no-op
// omission for Task 21's primitives (none of them render outside their own
// wrapper element), but Task 22's Modal.vue (and ConfirmDestructive.vue,
// built on it) uses @headlessui/vue's Dialog, which teleports its rendered
// content into a real `document.body` node (`#headlessui-portal-root`) --
// outside the wrapper's own DOM subtree entirely. Without auto-unmount,
// a Dialog left open at the end of one test leaks its portaled markup into
// `document.body` for every subsequent test in the same file, corrupting
// any assertion that queries `document.body` for teleported content.
enableAutoUnmount(afterEach);

// jsdom (this project's Vitest `environment`) has never implemented
// ResizeObserver. That was a non-issue for Task 21's primitives, but Task
// 22's Modal.vue (and anything built on it, e.g. ConfirmDestructive.vue)
// uses @headlessui/vue's Dialog, which internally does
// `new ResizeObserver(...)` on its panel element to auto-close if the panel
// collapses to zero size — the exact same headlessui Dialog machinery
// ConfirmDialog.vue already relies on in production. Without this stub,
// simply mounting any Dialog-based component under jsdom throws
// "ResizeObserver is not defined". A minimal no-op implementation is enough:
// these tests don't depend on resize callbacks ever firing.
//
// Assigned directly on `globalThis` (not via `vi.stubGlobal`, which the
// `afterEach` below undoes every test via `unstubAllGlobals`) because this
// is a permanent environment polyfill, not a per-test stub like `fetch`.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

function okJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: () => 'application/json',
    },
    // A few stores destructure nested objects straight off the response
    // (e.g. system.refreshAll() reads `data.statuses.snapserver`,
    // ServerConfig.vue does `JSON.parse(JSON.stringify(configStore
    // .serverConfigParsed))`). An empty top-level `{}` makes those throw —
    // caught internally and logged, not a test failure, but noisy. These
    // keys cover the shapes views read from on mount so that noise stays
    // out of the test run.
    json: async () => ({
      config: {},
      statuses: {},
      installed: {},
      versions: {},
      available: {},
    }),
    text: async () => '',
    blob: async () => new Blob(),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okJsonResponse()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
