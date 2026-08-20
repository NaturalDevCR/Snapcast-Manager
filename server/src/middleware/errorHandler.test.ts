// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- here it strips the return
// type of the hand-rolled mock `res` object's methods, leaving `res.body`
// typed as possibly-undefined and failing to compile. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/middleware/errorHandler.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `errorHandler.ts` file, which has
// no such pragma and is fully type-checked.
//
// Task 15: unit tests for the central error-handling middleware (safety
// net, not a replacement for each route's own try/catch -- see
// errorHandler.ts's header comment and .superpowers/sdd/task-15-brief.md
// requirement 4).
//
// Tested directly as a plain function against mock req/res/next objects --
// no need to spin up a real Express app or an HTTP server for this, since
// errorHandler has no dependency on anything but the (err, req, res, next)
// arguments Express hands it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from './errorHandler';

function makeRes(): any {
  const res: any = {
    statusCode: undefined,
    body: undefined,
    headersSent: false,
  };
  res.status = (code: any) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  return res;
}

test('errorHandler returns a generic message and no error detail when NODE_ENV=production', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = makeRes();
    const err = new Error('/etc/shadow permission denied at /var/lib/secret-path.db');
    let nextCalled = false;
    errorHandler(err, {} as any, res, (() => { nextCalled = true; }) as any);

    assert.equal(res.statusCode, 500);
    assert.equal(nextCalled, false);
    assert.equal(res.body.error, 'Internal server error');
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes('/etc/shadow'), 'production response must not leak the raw error message');
    assert.ok(!serialized.includes('secret-path.db'), 'production response must not leak filesystem details');
    assert.equal(res.body.stack, undefined, 'production response must not include a stack trace');
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('errorHandler includes error detail when NODE_ENV=development', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const res = makeRes();
    const err = new Error('boom: something specific broke');
    errorHandler(err, {} as any, res, (() => {}) as any);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Internal server error');
    assert.ok(String(res.body.detail).includes('boom: something specific broke'));
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('errorHandler delegates to next(err) instead of sending a second response once headers are already sent', () => {
  const res = makeRes();
  res.headersSent = true;
  let forwardedErr: unknown;
  const err = new Error('too late, response already started');
  errorHandler(err, {} as any, res, ((e: any) => { forwardedErr = e; }) as any);

  assert.equal(res.body, undefined, 'must not attempt res.json() after headers are sent');
  assert.equal(forwardedErr, err);
});

test('errorHandler handles a non-Error thrown value without crashing', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = makeRes();
    errorHandler('a plain string was thrown', {} as any, res, (() => {}) as any);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Internal server error');
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});
