// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's SSE-parsing
// helpers and fake-dep closures hit the same bug. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/routes/events.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `routes/events.ts` file, which has
// no such pragma and is fully type-checked.
//
// Task 25: GET /api/events SSE endpoint tests.
//
// No supertest (see auth.test.ts's identical note -- this repo has none):
// mounts authRouter (to obtain a real JWT the same way a real client would)
// plus events.ts's `createEventsRouter()` -- built with INJECTED fakes
// (short poll interval, fake systemd activeState(), fresh EventEmitters for
// snapcast/job updates) so tests are fast and deterministic instead of
// waiting on the real 5s poll or real snapcastLive/jobService singletons --
// on a plain express() app, listens on an ephemeral port, and drives it
// with Node's built-in global `fetch`, reading the streamed SSE body via
// `response.body.getReader()`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'events';
import express from 'express';

const tmpDbPath = path.join(os.tmpdir(), `events-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-fixed-secret-for-events-test-ts';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see
// auth.test.ts's identical note: a plain `import` compiles to a require()
// at this exact source position, which is what we need (DB_PATH must
// already be set, which it is above).
import authRouter from '../auth';
import { createEventsRouter } from './events';

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

let server: http.Server;
let baseUrl = '';
let authToken = '';

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const res = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'a-long-enough-test-password' }),
  });
  const json = await res.json();
  authToken = json.token;
  assert.ok(authToken, 'setup must return a usable token');
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---- SSE parsing helpers ----

function parseSseChunk(buffer: string): { events: { type: string; data: any }[]; rest: string } {
  const events: { type: string; data: any }[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    if (!part.trim()) continue;
    let type = '';
    let dataStr = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice('event: '.length);
      else if (line.startsWith('data: ')) dataStr += line.slice('data: '.length);
    }
    events.push({ type, data: dataStr ? JSON.parse(dataStr) : undefined });
  }
  return { events, rest };
}

/** Reads from an already-open fetch Response body until at least `minCount` SSE events are collected, or `timeoutMs` elapses. */
async function readSseEvents(
  response: Response,
  minCount: number,
  timeoutMs = 3000,
): Promise<{ type: string; data: any }[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const collected: { type: string; data: any }[] = [];
  const deadline = Date.now() + timeoutMs;
  try {
    while (collected.length < minCount) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('readSseEvents: timeout')), remaining)),
      ]);
      if (result.done) break;
      buf += decoder.decode(result.value, { stream: true });
      const { events, rest } = parseSseChunk(buf);
      buf = rest;
      collected.push(...events);
    }
  } finally {
    reader.releaseLock();
  }
  return collected;
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error('waitFor: timeout'));
      setTimeout(check, 10);
    };
    check();
  });
}

// ---- auth gate ----

test('GET /api/events without a token is rejected (401)', async () => {
  const eventsApp = express();
  eventsApp.use('/api/events', createEventsRouter({ pollIntervalMs: 50, services: [] }));
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    assert.equal(res.status, 401);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

// ---- Task 28: SSE ticket auth (POST /api/auth/sse-ticket + GET /api/events fallback) ----

test('POST /api/auth/sse-ticket requires authentication', async () => {
  const res = await fetch(`${baseUrl}/api/auth/sse-ticket`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /api/auth/sse-ticket mints a ticket for an authenticated user', async () => {
  const res = await fetch(`${baseUrl}/api/auth/sse-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(typeof json.ticket, 'string');
  assert.ok(json.ticket.length > 0);
  assert.ok(json.expiresAt > Date.now(), 'expiresAt must be in the future');
});

test('GET /api/events accepts a valid ticket in place of an Authorization header', async () => {
  const ticketRes = await fetch(`${baseUrl}/api/auth/sse-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const { ticket } = await ticketRes.json();

  const eventsApp = express();
  eventsApp.use('/api/events', createEventsRouter({ pollIntervalMs: 1000, services: [] }));
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    await res.body?.cancel();
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

test('GET /api/events rejects a replayed (already-used) ticket -- single-use enforcement', async () => {
  const ticketRes = await fetch(`${baseUrl}/api/auth/sse-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const { ticket } = await ticketRes.json();

  const eventsApp = express();
  eventsApp.use('/api/events', createEventsRouter({ pollIntervalMs: 1000, services: [] }));
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/events?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(first.status, 200, 'first use must succeed');
    await first.body?.cancel();

    const second = await fetch(`http://127.0.0.1:${port}/api/events?ticket=${encodeURIComponent(ticket)}`);
    assert.equal(second.status, 403, 'a replayed ticket must be rejected, even though it has not expired');
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

test('GET /api/events rejects a made-up/unknown ticket', async () => {
  const eventsApp = express();
  eventsApp.use('/api/events', createEventsRouter({ pollIntervalMs: 1000, services: [] }));
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events?ticket=not-a-real-ticket`);
    assert.equal(res.status, 403);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

test('GET /api/events still accepts a normal Authorization header, unchanged (backward compatible)', async () => {
  const eventsApp = express();
  eventsApp.use('/api/events', createEventsRouter({ pollIntervalMs: 1000, services: [] }));
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    await res.body?.cancel();
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

// ---- shape + baseline emission ----

test('GET /api/events streams an initial snapcast event and a service-status event', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  eventsApp.use(
    '/api/events',
    createEventsRouter({
      snapcastEvents,
      getCachedSnapcastStatus: () => null,
      jobEventsEmitter,
      getCurrentJob: () => undefined,
      activeState: async () => 'active',
      services: ['fakeservice'],
      pollIntervalMs: 50,
    }),
  );
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const events = await readSseEvents(res, 2);
    const snapcast = events.find((e) => e.type === 'snapcast');
    const serviceStatus = events.find((e) => e.type === 'service-status');
    assert.ok(snapcast, 'expected an initial snapcast event');
    assert.equal(snapcast!.data, null);
    assert.ok(serviceStatus, 'expected a service-status event');
    assert.deepEqual(serviceStatus!.data, [{ service: 'fakeservice', status: 'active' }]);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

// ---- service-status: only emitted when something actually changed ----

test('service-status is emitted once for an unchanging status across several poll ticks, and again after a real change', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  let status = 'active';
  let calls = 0;
  eventsApp.use(
    '/api/events',
    createEventsRouter({
      snapcastEvents,
      getCachedSnapcastStatus: () => null,
      jobEventsEmitter,
      getCurrentJob: () => undefined,
      activeState: async () => {
        calls += 1;
        return status;
      },
      services: ['fakeservice'],
      pollIntervalMs: 30,
    }),
  );
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    // Wait for several poll ticks worth of time while the status never changes.
    await waitFor(() => calls >= 4, 1000);
    status = 'inactive'; // now change it -- the NEXT tick should emit again
    const events = await readSseEvents(res, 3); // initial snapcast + initial service-status + the post-change service-status
    const statusEvents = events.filter((e) => e.type === 'service-status');
    assert.equal(statusEvents.length, 2, 'must emit once at baseline and once again after the real change -- not once per poll tick');
    assert.equal(statusEvents[0].data[0].status, 'active');
    assert.equal(statusEvents[1].data[0].status, 'inactive');
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

// ---- snapcast + job push-through ----

test('an emitted snapcast "update" is forwarded to the client as an SSE snapcast event', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  eventsApp.use(
    '/api/events',
    createEventsRouter({
      snapcastEvents,
      getCachedSnapcastStatus: () => null,
      jobEventsEmitter,
      getCurrentJob: () => undefined,
      activeState: async () => 'active',
      services: [],
      pollIntervalMs: 1000,
    }),
  );
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    await waitFor(() => snapcastEvents.listenerCount('update') === 1);
    const fakeStatus = { server: { server: { version: '9.9.9' }, groups: [], streams: [] } };
    snapcastEvents.emit('update', fakeStatus);

    // Initial burst is TWO events even with services: [] -- an empty-array
    // service-status result still differs from the "nothing polled yet"
    // `null` sentinel, so it's emitted once at connect -- plus the pushed
    // snapcast update makes three.
    const events = await readSseEvents(res, 3);
    const pushed = events.filter((e) => e.type === 'snapcast').pop();
    assert.deepEqual(pushed!.data, fakeStatus);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

test('an emitted job "update" is forwarded to the client as an SSE job event', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  eventsApp.use(
    '/api/events',
    createEventsRouter({
      snapcastEvents,
      getCachedSnapcastStatus: () => null,
      jobEventsEmitter,
      getCurrentJob: () => undefined,
      activeState: async () => 'active',
      services: [],
      pollIntervalMs: 1000,
    }),
  );
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    await waitFor(() => jobEventsEmitter.listenerCount('update') === 1);
    const fakeJob = { id: 'job1', label: 'Install snapserver', status: 'running', log: ['step 1'], startedAt: Date.now() };
    jobEventsEmitter.emit('update', fakeJob);

    // Initial burst: snapcast(null) + service-status([]) (see the sibling
    // test above for why an empty services list still emits once) + the
    // pushed job event.
    const events = await readSseEvents(res, 3);
    const job = events.find((e) => e.type === 'job');
    assert.deepEqual(job!.data, fakeJob);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

// ---- disconnect cleanup: no leaked listeners, no leaked interval ----

test('client disconnect removes the snapcast/job listeners and stops the service-status interval', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  let calls = 0;
  eventsApp.use(
    '/api/events',
    createEventsRouter({
      snapcastEvents,
      getCachedSnapcastStatus: () => null,
      jobEventsEmitter,
      getCurrentJob: () => undefined,
      activeState: async () => {
        calls += 1;
        return 'active';
      },
      services: ['fakeservice'],
      pollIntervalMs: 20,
    }),
  );
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal,
    });
    await waitFor(() => snapcastEvents.listenerCount('update') === 1 && jobEventsEmitter.listenerCount('update') === 1);
    await waitFor(() => calls >= 2); // prove the interval is genuinely running before we tear it down

    controller.abort();
    // res.body may still be readable for a moment after abort(); ignore any read error.
    try {
      await res.body?.cancel();
    } catch {
      /* expected once aborted */
    }

    await waitFor(() => snapcastEvents.listenerCount('update') === 0 && jobEventsEmitter.listenerCount('update') === 0);

    const callsAtDisconnect = calls;
    await new Promise((r) => setTimeout(r, 150)); // several poll intervals' worth of time
    assert.equal(calls, callsAtDisconnect, 'the service-status interval must not still be ticking after disconnect');
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

// ---- Task 27: graceful-shutdown connection tracking ----

test('closeAllConnections() sends a shutdown event and ends every open SSE connection', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  const router = createEventsRouter({
    snapcastEvents,
    getCachedSnapcastStatus: () => null,
    jobEventsEmitter,
    getCurrentJob: () => undefined,
    activeState: async () => 'active',
    services: [],
    pollIntervalMs: 1000,
  });
  eventsApp.use('/api/events', router);
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const resA = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const resB = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    await waitFor(() => snapcastEvents.listenerCount('update') === 2);

    router.closeAllConnections();

    // Initial burst is TWO events even with services: [] (snapcast(null) +
    // service-status([]) -- see the sibling tests above for why an
    // empty-array service-status result still differs from the "nothing
    // polled yet" null sentinel) plus the shutdown event makes three.
    const eventsA = await readSseEvents(resA, 3);
    const eventsB = await readSseEvents(resB, 3);
    assert.ok(eventsA.some((e) => e.type === 'shutdown'), 'client A must receive a shutdown event');
    assert.ok(eventsB.some((e) => e.type === 'shutdown'), 'client B must receive a shutdown event');

    // Both server-side responses must actually have ended -- the listeners
    // this router added to snapcastEvents/jobEventsEmitter must be cleaned
    // up, same as an ordinary client disconnect.
    await waitFor(() => snapcastEvents.listenerCount('update') === 0, 1000);
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

test('closeAllConnections() is a no-op when no SSE clients are connected', () => {
  const router = createEventsRouter({ pollIntervalMs: 1000, services: [] });
  assert.doesNotThrow(() => router.closeAllConnections());
});

// ---- concurrency: two independent SSE clients don't clobber each other ----

test('two concurrent SSE clients get independent listeners; disconnecting one leaves the other intact', async () => {
  const eventsApp = express();
  const snapcastEvents = new EventEmitter();
  const jobEventsEmitter = new EventEmitter();
  eventsApp.use(
    '/api/events',
    createEventsRouter({
      snapcastEvents,
      getCachedSnapcastStatus: () => null,
      jobEventsEmitter,
      getCurrentJob: () => undefined,
      activeState: async () => 'active',
      services: [],
      pollIntervalMs: 1000,
    }),
  );
  const s = eventsApp.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const port = (s.address() as any).port;
  try {
    const controllerA = new AbortController();
    const resA = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controllerA.signal,
    });
    const resB = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    await waitFor(() => snapcastEvents.listenerCount('update') === 2);

    controllerA.abort();
    try {
      await resA.body?.cancel();
    } catch {
      /* expected */
    }

    await waitFor(() => snapcastEvents.listenerCount('update') === 1, 1000);
    assert.equal(snapcastEvents.listenerCount('update'), 1, 'client B\'s listener must survive client A\'s disconnect');

    // Prove B is still actually live: push an update and read it off B's stream.
    // B's initial burst is two events (snapcast(null) + service-status([]),
    // see the sibling tests above) plus this pushed one.
    const fakeStatus = { server: { server: { version: '1.2.3' }, groups: [], streams: [] } };
    snapcastEvents.emit('update', fakeStatus);
    const events = await readSseEvents(resB, 3);
    const pushed = events.filter((e) => e.type === 'snapcast').pop();
    assert.deepEqual(pushed!.data, fakeStatus);

    await resB.body?.cancel();
  } finally {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});
