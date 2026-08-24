// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's `events`/
// `order` arrays and `releaseFirst`/`releaseA` deferred-promise resolvers
// are all name-bound function/array values, which is exactly the
// fingerprint that trips it. Correctness is independently confirmed with
// real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/platform/mutex.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `platform/mutex.ts` file, which has
// no such pragma and is fully type-checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KeyedMutex } from './mutex';

// ---- serialization on the same key ----

test('withLock: two calls on the same key run strictly one after another (second never starts before first finishes)', async () => {
  const mutex = new KeyedMutex();
  const events: string[] = [];

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => {
    releaseFirst = resolve;
  });

  const first = mutex.withLock('k', async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
  });

  // Give the first call's synchronous prefix a chance to run and register
  // itself as the tail for 'k' before we queue the second call.
  await Promise.resolve();

  const second = mutex.withLock('k', async () => {
    events.push('second:start');
    events.push('second:end');
  });

  // At this point 'first' is blocked on firstGate and 'second' must not
  // have started yet -- prove it by giving the event loop several ticks
  // and confirming 'second:start' still hasn't been recorded.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(events, ['first:start'], 'second must not start while first still holds the lock');

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('withLock: calls on DIFFERENT keys run independently (no cross-key blocking)', async () => {
  const mutex = new KeyedMutex();
  const events: string[] = [];

  let releaseA!: () => void;
  const gateA = new Promise<void>(resolve => {
    releaseA = resolve;
  });

  const a = mutex.withLock('key-a', async () => {
    events.push('a:start');
    await gateA;
    events.push('a:end');
  });

  await Promise.resolve();

  // 'key-b' is a different key -- this must run to completion even though
  // 'a' is still blocked on gateA.
  const b = mutex.withLock('key-b', async () => {
    events.push('b:start');
    events.push('b:end');
  });

  await b;
  assert.deepEqual(events, ['a:start', 'b:start', 'b:end'], 'different keys must not block each other');

  releaseA();
  await a;
  assert.deepEqual(events, ['a:start', 'b:start', 'b:end', 'a:end']);
});

// ---- return value / error propagation ----

test('withLock: resolves with whatever fn resolves with', async () => {
  const mutex = new KeyedMutex();
  const result = await mutex.withLock('k', async () => 42);
  assert.equal(result, 42);
});

test('withLock: rejects the caller with fn\'s real error', async () => {
  const mutex = new KeyedMutex();
  await assert.rejects(
    () => mutex.withLock('k', async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
});

test('withLock: a failing critical section does not wedge the queue -- the NEXT call on the same key still runs', async () => {
  const mutex = new KeyedMutex();
  const events: string[] = [];

  const first = mutex.withLock('k', async () => {
    events.push('first');
    throw new Error('first failed');
  });

  const second = mutex.withLock('k', async () => {
    events.push('second');
    return 'second-result';
  });

  await assert.rejects(() => first, /first failed/);
  const secondResult = await second;

  assert.equal(secondResult, 'second-result');
  assert.deepEqual(events, ['first', 'second']);
});

test('withLock: three queued calls on the same key run in the order withLock was invoked', async () => {
  const mutex = new KeyedMutex();
  const order: number[] = [];

  const p1 = mutex.withLock('k', async () => {
    order.push(1);
  });
  const p2 = mutex.withLock('k', async () => {
    order.push(2);
  });
  const p3 = mutex.withLock('k', async () => {
    order.push(3);
  });

  await Promise.all([p1, p2, p3]);
  assert.deepEqual(order, [1, 2, 3]);
});
