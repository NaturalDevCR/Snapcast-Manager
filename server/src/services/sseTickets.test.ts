// Task 28: unit tests for the short-lived, single-use SSE ticket store.
//
// Dependency-injected clock + token generator (mirroring
// services/snapcastLive.ts's `random`/`setTimeoutFn` injection pattern) so
// expiry and mint-ordering are deterministic without any real waiting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseTicketStore } from './sseTickets';

test('mint() returns a ticket string and an expiry timestamp `ttlMs` in the future', () => {
  const store = new SseTicketStore({ now: () => 1000, ttlMs: 30_000, randomToken: () => 'tok-a' });
  const { ticket, expiresAt } = store.mint(7, '10.0.0.1');
  assert.equal(ticket, 'tok-a');
  assert.equal(expiresAt, 31_000);
});

test('consume() with a valid ticket and matching IP returns the minted userId', () => {
  const store = new SseTicketStore({ now: () => 0, ttlMs: 30_000, randomToken: () => 'tok-b' });
  store.mint(42, '10.0.0.1');
  assert.equal(store.consume('tok-b', '10.0.0.1'), 42);
});

test('consume() rejects an unknown ticket', () => {
  const store = new SseTicketStore();
  assert.equal(store.consume('does-not-exist', '10.0.0.1'), null);
});

test('consume() is single-use -- a second consume of the same ticket fails (replay rejected)', () => {
  const store = new SseTicketStore({ now: () => 0, ttlMs: 30_000, randomToken: () => 'tok-c' });
  store.mint(1, '10.0.0.1');
  assert.equal(store.consume('tok-c', '10.0.0.1'), 1, 'first use must succeed');
  assert.equal(store.consume('tok-c', '10.0.0.1'), null, 'replayed ticket must fail');
});

test('consume() rejects a ticket past its TTL', () => {
  let time = 0;
  const store = new SseTicketStore({ now: () => time, ttlMs: 30_000, randomToken: () => 'tok-d' });
  store.mint(2, '10.0.0.1');
  time = 30_001; // just past expiry
  assert.equal(store.consume('tok-d', '10.0.0.1'), null);
});

test('consume() accepts a ticket right up to (not past) its TTL boundary', () => {
  let time = 0;
  const store = new SseTicketStore({ now: () => time, ttlMs: 30_000, randomToken: () => 'tok-d2' });
  store.mint(2, '10.0.0.1');
  time = 30_000; // exactly at expiry -- still valid
  assert.equal(store.consume('tok-d2', '10.0.0.1'), 2);
});

test('consume() rejects a ticket presented from a different IP than it was minted for', () => {
  const store = new SseTicketStore({ now: () => 0, ttlMs: 30_000, randomToken: () => 'tok-e' });
  store.mint(3, '10.0.0.1');
  assert.equal(store.consume('tok-e', '10.0.0.2'), null, 'wrong-IP consume must fail');
});

test('a ticket consumed from the wrong IP is also deleted -- the legitimate IP cannot use it afterward either', () => {
  const store = new SseTicketStore({ now: () => 0, ttlMs: 30_000, randomToken: () => 'tok-f' });
  store.mint(4, '10.0.0.1');
  assert.equal(store.consume('tok-f', '10.0.0.2'), null); // wrong IP, fails, but still consumes
  assert.equal(store.consume('tok-f', '10.0.0.1'), null, 'ticket already gone even for the correct IP');
});

test('sweep() removes expired-but-never-consumed tickets after enough mints', () => {
  let time = 0;
  let counter = 0;
  const store = new SseTicketStore({ now: () => time, ttlMs: 1000, randomToken: () => `t${counter++}` });
  for (let i = 0; i < 49; i++) store.mint(1, '10.0.0.1');
  assert.equal(store.size(), 49);
  time = 5000; // well past all 49 tickets' expiry
  store.mint(1, '10.0.0.1'); // the 50th mint triggers a full sweep
  assert.equal(store.size(), 1, 'sweep must have cleared the 49 expired tickets, leaving only the fresh one');
});

test('two different users each get their own independently-consumable ticket', () => {
  let counter = 0;
  const store = new SseTicketStore({ now: () => 0, ttlMs: 30_000, randomToken: () => `tok-${counter++}` });
  store.mint(1, '10.0.0.1');
  store.mint(2, '10.0.0.1');
  assert.equal(store.consume('tok-0', '10.0.0.1'), 1);
  assert.equal(store.consume('tok-1', '10.0.0.1'), 2);
});
