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
