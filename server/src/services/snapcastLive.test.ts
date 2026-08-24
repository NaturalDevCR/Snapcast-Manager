// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's fake WS/timer
// helpers bind parameterized functions to object properties/module exports,
// which hits the same bug. Correctness is independently confirmed with real
// type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/snapcastLive.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/snapcastLive.ts` file,
// which has no such pragma and is fully type-checked.
//
// Task 25: server/src/services/snapcastLive.ts's persistent-WS-client +
// state-cache tests.
//
// No mocking framework and no interception of the `ws` module itself (this
// repo has no precedent for either -- `node:test` ships no built-in module
// mocker usable here, and the rest of this codebase's tests stub things via
// plain dependency injection, e.g. jobs.test.ts's injectable `db`,
// watchdog.test.ts's `stubModuleFn`). snapcastLive.ts is instead built with
// its WebSocket-construction, HTTP-status-fetch, timer, and RNG calls all
// injected via its constructor's `SnapcastLiveDeps` -- this establishes that
// same DI pattern for "mock a WebSocket" specifically: `FakeWs` below is a
// minimal EventEmitter satisfying just the `on/close` surface
// SnapcastLiveClient actually uses, with no relationship to the real `ws`
// package at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { SnapcastLiveClient, type WsLike } from './snapcastLive';

/** Minimal fake satisfying WsLike -- an EventEmitter with the small subset of `ws`'s WebSocket surface this module calls. */
class FakeWs extends EventEmitter implements WsLike {
  closed = false;
  close(): void {
    this.closed = true;
  }
}

function baseStatus(): any {
  return {
    server: {
      server: { version: '0.27.0' },
      groups: [
        {
          id: 'group1',
          name: 'Living Room',
          stream_id: 'stream1',
          muted: false,
          clients: [
            {
              id: 'client1',
              host: { ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', name: 'kitchen-pi', os: 'Linux' },
              config: { name: 'Kitchen', volume: { muted: false, percent: 50 } },
              connected: true,
            },
          ],
        },
      ],
      streams: [{ id: 'stream1', status: 'playing', uri: { query: { name: 'Spotify' }, scheme: 'pipe' } }],
    },
  };
}

/** Builds a client wired to fully-controllable fakes: a queue of FakeWs instances (one per connect() call), a stubbed fetchStatus(), captured setTimeout calls (never actually fire on their own -- tests invoke the captured callback directly), and a fixed random() so backoff math is exact, not a jittered range. */
function newTestClient(overrides: { fetchStatus?: () => Promise<any> } = {}) {
  const wsInstances: FakeWs[] = [];
  const timeoutCalls: { cb: () => void; ms: number }[] = [];
  const errors: string[] = [];
  let fetchStatusCalls = 0;
  const fetchStatusImpl = overrides.fetchStatus ?? (async () => baseStatus());

  const client = new SnapcastLiveClient({
    wsFactory: () => {
      const ws = new FakeWs();
      wsInstances.push(ws);
      return ws;
    },
    fetchStatus: () => {
      fetchStatusCalls += 1;
      return fetchStatusImpl();
    },
    setTimeoutFn: (cb, ms) => {
      timeoutCalls.push({ cb, ms });
      return timeoutCalls.length as unknown as NodeJS.Timeout;
    },
    clearTimeoutFn: () => {},
    random: () => 0.5, // rand*2-1 == 0 -- no jitter, delay == exact base
    logger: { error: (msg: string) => errors.push(msg) },
  });

  return {
    client,
    wsInstances,
    timeoutCalls,
    errors,
    fetchStatusCallCount: () => fetchStatusCalls,
    /** Fires 'open' on the most recently created FakeWs and flushes the resulting fetchStatus() promise. */
    async openLatest() {
      const ws = wsInstances[wsInstances.length - 1];
      ws.emit('open');
      await new Promise((r) => setImmediate(r));
    },
    /** Sends a notification message on the most recently created FakeWs and flushes any resulting async work. */
    async notify(method: string, params: any) {
      const ws = wsInstances[wsInstances.length - 1];
      ws.emit('message', JSON.stringify({ jsonrpc: '2.0', method, params }));
      await new Promise((r) => setImmediate(r));
    },
  };
}

// ---- getCachedStatus() before first connect ----

test('getCachedStatus() returns null before any successful connect', () => {
  const { client } = newTestClient();
  assert.equal(client.getCachedStatus(), null);
});

test('start() connects and getCachedStatus() stays null until open + Server.GetStatus resolves', async () => {
  const { client, openLatest } = newTestClient();
  client.start();
  assert.equal(client.getCachedStatus(), null);
  await openLatest();
  assert.deepEqual(client.getCachedStatus(), baseStatus());
});

test('a successful connect emits an "update" event with the fetched status', async () => {
  const { client, openLatest } = newTestClient();
  const updates: any[] = [];
  client.on('update', (s) => updates.push(s));
  client.start();
  await openLatest();
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], baseStatus());
});

// ---- precise merges: each notification type the brief requires ----

test('Client.OnVolumeChanged: precise merge, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();
  assert.equal(fetchStatusCallCount(), 1);

  await notify('Client.OnVolumeChanged', { id: 'client1', volume: { muted: true, percent: 77 } });

  assert.equal(fetchStatusCallCount(), 1, 'must not have re-fetched full status');
  const cached = client.getCachedStatus()!;
  assert.deepEqual(cached.server.groups[0].clients[0].config.volume, { muted: true, percent: 77 });
});

test('Client.OnNameChanged: precise merge, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Client.OnNameChanged', { id: 'client1', name: 'Bedroom Speaker' });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.groups[0].clients[0].config.name, 'Bedroom Speaker');
});

test('Client.OnConnect: precise merge for an ALREADY-KNOWN client, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  const updatedClient = {
    id: 'client1',
    host: { ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', name: 'kitchen-pi', os: 'Linux' },
    config: { name: 'Kitchen', volume: { muted: false, percent: 50 } },
    connected: true,
  };
  await notify('Client.OnConnect', { id: 'client1', client: updatedClient });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.groups[0].clients[0].connected, true);
});

test('Client.OnConnect: unknown/brand-new client falls back to refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Client.OnConnect', {
    id: 'never-seen-before',
    client: { id: 'never-seen-before', host: {}, config: { name: 'X', volume: { muted: false, percent: 0 } }, connected: true },
  });

  assert.equal(fetchStatusCallCount(), 2, 'unknown client must trigger a fallback refetch');
});

test('Client.OnDisconnect: precise merge, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  const disconnectedClient = {
    id: 'client1',
    host: { ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', name: 'kitchen-pi', os: 'Linux' },
    config: { name: 'Kitchen', volume: { muted: false, percent: 50 } },
    connected: false,
  };
  await notify('Client.OnDisconnect', { id: 'client1', client: disconnectedClient });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.groups[0].clients[0].connected, false);
});

test('Group.OnStreamChanged: precise merge, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Group.OnStreamChanged', { id: 'group1', stream_id: 'stream2' });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.groups[0].stream_id, 'stream2');
});

test('Group.OnMute: precise merge, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Group.OnMute', { id: 'group1', mute: true });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.groups[0].muted, true);
});

test('Group.OnNameChanged: precise merge, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Group.OnNameChanged', { id: 'group1', name: 'Upstairs' });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.groups[0].name, 'Upstairs');
});

test('Stream.OnUpdate: precise merge for an existing stream, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Stream.OnUpdate', { id: 'stream1', stream: { id: 'stream1', status: 'idle', uri: { query: { name: 'Spotify' }, scheme: 'pipe' } } });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.streams[0].status, 'idle');
});

test('Stream.OnUpdate: appends a stream not already in the cache, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Stream.OnUpdate', { id: 'stream-new', stream: { id: 'stream-new', status: 'idle', uri: { query: {}, scheme: 'tcp' } } });

  assert.equal(fetchStatusCallCount(), 1);
  assert.equal(client.getCachedStatus()!.server.streams.length, 2);
});

test('Server.OnUpdate: full-cache replacement, no refetch', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  const replacement = { server: { version: '0.28.0' }, groups: [], streams: [] };
  await notify('Server.OnUpdate', { server: replacement });

  assert.equal(fetchStatusCallCount(), 1, 'Server.OnUpdate replaces in place, does not itself trigger a refetch');
  assert.deepEqual(client.getCachedStatus()!.server, replacement);
});

// ---- fallback-refetch for anything not precisely merged ----

test('an unrecognized notification method falls back to a full refetch', async () => {
  let n = 0;
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient({
    fetchStatus: async () => {
      n += 1;
      const s = baseStatus();
      s.server.server.version = `refetched-${n}`;
      return s;
    },
  });
  client.start();
  await openLatest();
  assert.equal(fetchStatusCallCount(), 1);

  await notify('Client.OnLatencyChanged', { id: 'client1', latency: 5 });

  assert.equal(fetchStatusCallCount(), 2);
  assert.equal(client.getCachedStatus()!.server.server.version, 'refetched-2');
});

test('a known method with a malformed/missing payload falls back to a refetch rather than corrupting the cache', async () => {
  const { client, openLatest, notify, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();

  await notify('Client.OnVolumeChanged', { id: 'client1' /* missing volume */ });

  assert.equal(fetchStatusCallCount(), 2);
});

test('a notification arriving before any cache exists falls back to a refetch', async () => {
  const { client, wsInstances, fetchStatusCallCount } = newTestClient();
  client.start();
  const ws = wsInstances[0];
  // No 'open' fired yet -- cache is still null.
  ws.emit('message', JSON.stringify({ jsonrpc: '2.0', method: 'Client.OnVolumeChanged', params: { id: 'client1', volume: { muted: false, percent: 1 } } }));
  await new Promise((r) => setImmediate(r));

  assert.equal(fetchStatusCallCount(), 1);
});

// ---- reconnection with exponential backoff + jitter ----

test('close schedules a reconnect at ~1s for the first attempt', () => {
  const { client, wsInstances, timeoutCalls } = newTestClient();
  client.start();
  wsInstances[0].emit('close');
  assert.equal(timeoutCalls.length, 1);
  assert.equal(timeoutCalls[0].ms, 1000); // random()==0.5 -> zero jitter -> exact base
});

test('backoff doubles on each consecutive failure: 1s, 2s, 4s, 8s', () => {
  const { client, wsInstances, timeoutCalls } = newTestClient();
  client.start();
  wsInstances[0].emit('close');
  timeoutCalls[0].cb(); // reconnect attempt 2
  wsInstances[1].emit('close');
  timeoutCalls[1].cb(); // reconnect attempt 3
  wsInstances[2].emit('close');
  timeoutCalls[2].cb(); // reconnect attempt 4
  wsInstances[3].emit('close');

  assert.deepEqual(
    timeoutCalls.map((t) => t.ms),
    [1000, 2000, 4000, 8000],
  );
});

test('backoff is capped at 30s', () => {
  const { client, wsInstances, timeoutCalls } = newTestClient();
  client.start();
  // Drive enough consecutive failures to exceed the cap (1,2,4,8,16,32->capped at 30).
  wsInstances[0].emit('close');
  for (let i = 0; i < 6; i++) {
    timeoutCalls[timeoutCalls.length - 1].cb();
    wsInstances[wsInstances.length - 1].emit('close');
  }
  const last = timeoutCalls[timeoutCalls.length - 1].ms;
  assert.equal(last, 30_000);
});

test('a successful open resets the backoff back to ~1s on the next failure', async () => {
  const { client, wsInstances, timeoutCalls, openLatest } = newTestClient();
  client.start();
  wsInstances[0].emit('close'); // attempt 1 -> schedules 1000ms
  timeoutCalls[0].cb(); // reconnect -> wsInstances[1]
  wsInstances[1].emit('close'); // attempt 2 -> schedules 2000ms
  timeoutCalls[1].cb(); // reconnect -> wsInstances[2]

  await openLatest(); // successful open resets reconnectAttempts to 0

  wsInstances[2].emit('close'); // failure right after a successful connect -> back to attempt 1
  assert.equal(timeoutCalls[timeoutCalls.length - 1].ms, 1000);
});

test('stop() prevents a scheduled reconnect from running and further closes from scheduling new ones', () => {
  const { client, wsInstances, timeoutCalls } = newTestClient();
  client.start();
  wsInstances[0].emit('close');
  assert.equal(timeoutCalls.length, 1);
  client.stop();
  wsInstances[0].emit('close'); // late/duplicate close after stop() -- must not schedule anything
  assert.equal(timeoutCalls.length, 1);
});

// ---- log-frequency capping (don't flood the console when snapserver is permanently absent) ----

test('logs the 1st connection failure, stays silent for attempts 2-9, logs again at attempt 10', () => {
  const { client, wsInstances, timeoutCalls, errors } = newTestClient();
  client.start();
  wsInstances[0].emit('error', new Error('ECONNREFUSED'));
  wsInstances[0].emit('close');
  assert.equal(errors.length, 1);

  for (let attempt = 2; attempt <= 9; attempt++) {
    timeoutCalls[timeoutCalls.length - 1].cb();
    const ws = wsInstances[wsInstances.length - 1];
    ws.emit('error', new Error('ECONNREFUSED'));
    ws.emit('close');
  }
  assert.equal(errors.length, 1, 'attempts 2-9 must stay silent');

  timeoutCalls[timeoutCalls.length - 1].cb(); // attempt 10
  const ws10 = wsInstances[wsInstances.length - 1];
  ws10.emit('error', new Error('ECONNREFUSED'));
  ws10.emit('close');
  assert.equal(errors.length, 2, 'attempt 10 must log again');
});

// ---- malformed WS payloads never throw ----

test('a non-JSON message is ignored, not thrown', async () => {
  const { client, openLatest, wsInstances, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();
  assert.doesNotThrow(() => wsInstances[0].emit('message', 'not json {{{'));
  await new Promise((r) => setImmediate(r));
  assert.equal(fetchStatusCallCount(), 1);
});

test('a message carrying an id (a response, not a notification) is ignored', async () => {
  const { client, openLatest, wsInstances, fetchStatusCallCount } = newTestClient();
  client.start();
  await openLatest();
  wsInstances[0].emit('message', JSON.stringify({ jsonrpc: '2.0', id: 42, result: {} }));
  await new Promise((r) => setImmediate(r));
  assert.equal(fetchStatusCallCount(), 1);
});
