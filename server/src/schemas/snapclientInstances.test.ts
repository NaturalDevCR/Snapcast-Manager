// Task 23: focused tests for the Zod schemas that replaced
// routes/snapclientInstances.ts's pre-existing inline
// `if (!x) return res.status(400)...` checks. See
// schemas/pipeSources.test.ts's header comment for why these call the
// schema's own `.safeParse()` directly rather than standing up a real
// Express app (no route/HTTP-level test harness exists in this codebase).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  controlSnapclientInstanceParamsSchema,
  createSnapclientInstanceBodySchema,
  setAlsaVolumeBodySchema,
} from './snapclientInstances';

// ---- POST / (create instance) ----

test('createSnapclientInstanceBodySchema requires both name and soundcard', () => {
  assert.equal(createSnapclientInstanceBodySchema.safeParse({ soundcard: 'hw:0' }).success, false);
  assert.equal(createSnapclientInstanceBodySchema.safeParse({ name: 'Kitchen' }).success, false);
  assert.equal(createSnapclientInstanceBodySchema.safeParse({}).success, false);
});

test('createSnapclientInstanceBodySchema defaults host to 127.0.0.1 and port to 1704 when omitted', () => {
  const result = createSnapclientInstanceBodySchema.safeParse({ name: 'Kitchen', soundcard: 'hw:0' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.host, '127.0.0.1');
    assert.equal(result.data.port, 1704);
  }
});

test('createSnapclientInstanceBodySchema falls back an explicit port of 0 to 1704 (matches pre-migration `port || 1704`)', () => {
  const result = createSnapclientInstanceBodySchema.safeParse({ name: 'Kitchen', soundcard: 'hw:0', port: 0 });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.port, 1704);
});

test('createSnapclientInstanceBodySchema keeps an explicit host/port when provided', () => {
  const result = createSnapclientInstanceBodySchema.safeParse({
    name: 'Kitchen',
    soundcard: 'hw:0',
    host: '10.0.0.5',
    port: 1705,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.host, '10.0.0.5');
    assert.equal(result.data.port, 1705);
  }
});

test('createSnapclientInstanceBodySchema passes hostId through untouched when present, omits it when absent', () => {
  const withHostId = createSnapclientInstanceBodySchema.safeParse({ name: 'K', soundcard: 'hw:0', hostId: 'abc' });
  assert.equal(withHostId.success, true);
  if (withHostId.success) assert.equal(withHostId.data.hostId, 'abc');

  const withoutHostId = createSnapclientInstanceBodySchema.safeParse({ name: 'K', soundcard: 'hw:0' });
  assert.equal(withoutHostId.success, true);
  if (withoutHostId.success) assert.equal(withoutHostId.data.hostId, undefined);
});

// ---- POST /alsa/:cardId ----

test('setAlsaVolumeBodySchema requires control to be a string and percent to be a number', () => {
  assert.equal(setAlsaVolumeBodySchema.safeParse({ control: 'Master', percent: '50' }).success, false, 'percent as a string must be rejected, matching `typeof percent !== "number"`');
  assert.equal(setAlsaVolumeBodySchema.safeParse({ control: 5, percent: 50 }).success, false, 'control as a number must be rejected, matching `typeof control !== "string"`');
  assert.equal(setAlsaVolumeBodySchema.safeParse({ control: 'Master', percent: 50 }).success, true);
});

// ---- POST /:id/:action ----

test('controlSnapclientInstanceParamsSchema accepts each of the five original allowed actions and keeps id', () => {
  for (const action of ['start', 'stop', 'restart', 'enable', 'disable']) {
    const result = controlSnapclientInstanceParamsSchema.safeParse({ id: 'abc-123', action });
    assert.equal(result.success, true, action);
    if (result.success) assert.equal(result.data.id, 'abc-123', 'id must survive the params schema, not be stripped');
  }
});

test('controlSnapclientInstanceParamsSchema rejects an action outside the allowlist', () => {
  const result = controlSnapclientInstanceParamsSchema.safeParse({ id: 'abc-123', action: 'reboot' });
  assert.equal(result.success, false);
});
