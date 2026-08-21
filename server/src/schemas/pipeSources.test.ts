// Task 23: focused tests for the Zod schemas that replaced
// routes/pipeSources.ts's pre-existing inline `if (!x) return
// res.status(400)...` checks. There is no existing route/HTTP-level test
// harness in this codebase (server/src/services/pipeSources.test.ts tests
// the service class directly, not the Express router) -- these tests
// follow that same established pattern: call the schema's own
// `.safeParse()` directly rather than standing up a real Express app.
//
// The `validateStreamUrl` tests are the ones task-23-brief.md specifically
// calls out: a Stage 1 security guarantee (the character allowlist that
// stops a stream URL from breaking out of a systemd ExecStart line's
// quoted string) that this migration must not regress.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptPipeSourceBodySchema,
  controlPipeSourceBodySchema,
  createPipeSourceBodySchema,
  setPipeSourceConfigBodySchema,
  updatePipeSourceBodySchema,
  validateStreamUrl,
} from './pipeSources';

// ---- validateStreamUrl: the Stage 1 security guarantee ----

test('validateStreamUrl rejects a URL containing a backtick (shell command substitution)', () => {
  const err = validateStreamUrl('http://example.com/`rm -rf /`');
  assert.notEqual(err, null);
});

test('validateStreamUrl rejects a URL containing a $ (shell variable/command expansion)', () => {
  const err = validateStreamUrl('http://example.com/$(whoami)');
  assert.notEqual(err, null);
});

test('validateStreamUrl rejects a URL containing a ; (shell command separator)', () => {
  const err = validateStreamUrl('http://example.com/stream; rm -rf /');
  assert.notEqual(err, null);
});

test('validateStreamUrl rejects quotes and backslashes too', () => {
  assert.notEqual(validateStreamUrl(`http://example.com/"quoted"`), null);
  assert.notEqual(validateStreamUrl(`http://example.com/'quoted'`), null);
  assert.notEqual(validateStreamUrl('http://example.com/back\\slash'), null);
});

test('validateStreamUrl rejects a URL missing the http(s):// scheme', () => {
  assert.notEqual(validateStreamUrl('ftp://example.com/stream'), null);
  assert.notEqual(validateStreamUrl('example.com/stream'), null);
});

test('validateStreamUrl rejects a URL containing whitespace', () => {
  assert.notEqual(validateStreamUrl('http://example.com/my stream'), null);
});

test('validateStreamUrl accepts an ordinary http(s) stream URL', () => {
  assert.equal(validateStreamUrl('http://example.com:8000/stream.mp3'), null);
  assert.equal(validateStreamUrl('https://example.com/stream'), null);
});

// ---- POST / (create) -- the same allowlist reachable through the full schema ----

test('createPipeSourceBodySchema rejects a radio source whose url contains a backtick/$/; payload', () => {
  for (const payload of ['http://x/`id`', 'http://x/$(id)', 'http://x/a;b']) {
    const result = createPipeSourceBodySchema.safeParse({ name: 'Evil', type: 'radio', url: payload });
    assert.equal(result.success, false, `expected rejection for: ${payload}`);
  }
});

test('createPipeSourceBodySchema requires name', () => {
  const result = createPipeSourceBodySchema.safeParse({ type: 'radio', url: 'http://x/y' });
  assert.equal(result.success, false);
});

test('createPipeSourceBodySchema requires url for radio-type sources', () => {
  const result = createPipeSourceBodySchema.safeParse({ name: 'Radio 1', type: 'radio' });
  assert.equal(result.success, false);
});

test('createPipeSourceBodySchema allows mpd-type sources with no url', () => {
  const result = createPipeSourceBodySchema.safeParse({ name: 'MPD', type: 'mpd' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.url, '');
    assert.equal(result.data.type, 'mpd');
  }
});

test('createPipeSourceBodySchema defaults an unrecognized/missing type to radio (matches pre-migration `type === "mpd" ? "mpd" : "radio"`)', () => {
  const result = createPipeSourceBodySchema.safeParse({ name: 'X', type: 'nonsense', url: 'http://x/y' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.type, 'radio');
});

test('createPipeSourceBodySchema trims name and url', () => {
  const result = createPipeSourceBodySchema.safeParse({ name: '  Radio 1  ', type: 'radio', url: '  http://x/y  ' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, 'Radio 1');
    assert.equal(result.data.url, 'http://x/y');
  }
});

test('createPipeSourceBodySchema defaults reconnect flags to true and treats only literal false as false (matches pre-migration `x !== false`)', () => {
  const omitted = createPipeSourceBodySchema.safeParse({ name: 'X', type: 'radio', url: 'http://x/y' });
  assert.equal(omitted.success, true);
  if (omitted.success) {
    assert.equal(omitted.data.reconnect, true);
    assert.equal(omitted.data.reconnectStreamed, true);
    assert.equal(omitted.data.reconnectAtEof, true);
    assert.equal(omitted.data.enabled, true);
  }

  const explicitFalse = createPipeSourceBodySchema.safeParse({
    name: 'X',
    type: 'radio',
    url: 'http://x/y',
    reconnect: false,
  });
  assert.equal(explicitFalse.success, true);
  if (explicitFalse.success) assert.equal(explicitFalse.data.reconnect, false);

  const weirdTruthy = createPipeSourceBodySchema.safeParse({
    name: 'X',
    type: 'radio',
    url: 'http://x/y',
    reconnect: 'nope', // truthy string, not literal `false` -- old code treated this as true
  });
  assert.equal(weirdTruthy.success, true);
  if (weirdTruthy.success) assert.equal(weirdTruthy.data.reconnect, true);
});

test('createPipeSourceBodySchema falls back reconnectDelayMax/idleThreshold to defaults on NaN or 0 (matches pre-migration `Number(x) || fallback`)', () => {
  const missing = createPipeSourceBodySchema.safeParse({ name: 'X', type: 'radio', url: 'http://x/y' });
  assert.equal(missing.success, true);
  if (missing.success) {
    assert.equal(missing.data.reconnectDelayMax, 30);
    assert.equal(missing.data.idleThreshold, 15000);
  }

  const zeroed = createPipeSourceBodySchema.safeParse({
    name: 'X',
    type: 'radio',
    url: 'http://x/y',
    reconnectDelayMax: 0,
    idleThreshold: '0',
  });
  assert.equal(zeroed.success, true);
  if (zeroed.success) {
    assert.equal(zeroed.data.reconnectDelayMax, 30, 'an explicit 0 falls back too, matching `0 || 30`');
    assert.equal(zeroed.data.idleThreshold, 15000);
  }

  const numeric = createPipeSourceBodySchema.safeParse({
    name: 'X',
    type: 'radio',
    url: 'http://x/y',
    reconnectDelayMax: '45',
    idleThreshold: 20000,
  });
  assert.equal(numeric.success, true);
  if (numeric.success) {
    assert.equal(numeric.data.reconnectDelayMax, 45);
    assert.equal(numeric.data.idleThreshold, 20000);
  }
});

// ---- PUT /:id (update) ----

test('updatePipeSourceBodySchema rejects a backtick/$/; payload in url, same as create', () => {
  for (const payload of ['http://x/`id`', 'http://x/$(id)', 'http://x/a;b']) {
    const result = updatePipeSourceBodySchema.safeParse({ url: payload });
    assert.equal(result.success, false, `expected rejection for: ${payload}`);
  }
});

test('updatePipeSourceBodySchema allows an empty url (clearing it), matching the pre-migration exemption', () => {
  const result = updatePipeSourceBodySchema.safeParse({ url: '' });
  assert.equal(result.success, true);
});

test('updatePipeSourceBodySchema allows a completely empty partial update', () => {
  const result = updatePipeSourceBodySchema.safeParse({});
  assert.equal(result.success, true);
});

test('updatePipeSourceBodySchema allows updating a single field without requiring the others', () => {
  const result = updatePipeSourceBodySchema.safeParse({ enabled: false });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.data, { enabled: false });
});

// ---- POST /:id/control ----

test('controlPipeSourceBodySchema accepts each of the five original allowed actions', () => {
  for (const action of ['start', 'stop', 'restart', 'enable', 'disable']) {
    const result = controlPipeSourceBodySchema.safeParse({ action });
    assert.equal(result.success, true, action);
  }
});

test('controlPipeSourceBodySchema rejects an action outside the allowlist', () => {
  const result = controlPipeSourceBodySchema.safeParse({ action: 'reboot' });
  assert.equal(result.success, false);
});

// ---- PUT /:id/config ----

test('setPipeSourceConfigBodySchema requires content to be a string', () => {
  assert.equal(setPipeSourceConfigBodySchema.safeParse({}).success, false);
  assert.equal(setPipeSourceConfigBodySchema.safeParse({ content: 42 }).success, false);
});

test('setPipeSourceConfigBodySchema allows an empty string as content', () => {
  const result = setPipeSourceConfigBodySchema.safeParse({ content: '' });
  assert.equal(result.success, true);
});

// ---- POST /adopt ----

test('adoptPipeSourceBodySchema rejects a backtick/$/; payload in url, same as create', () => {
  for (const payload of ['http://x/`id`', 'http://x/$(id)', 'http://x/a;b']) {
    const result = adoptPipeSourceBodySchema.safeParse({ name: 'X', url: payload });
    assert.equal(result.success, false, `expected rejection for: ${payload}`);
  }
});

test('adoptPipeSourceBodySchema does NOT require a url for radio-type sources (differs from create -- preserved exactly)', () => {
  const result = adoptPipeSourceBodySchema.safeParse({ name: 'X', type: 'radio' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.url, '');
});

test('adoptPipeSourceBodySchema turns an empty existingServiceName into undefined (matches `existingServiceName || undefined`)', () => {
  const result = adoptPipeSourceBodySchema.safeParse({ name: 'X', type: 'mpd', existingServiceName: '' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.existingServiceName, undefined);
});
