// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/middleware/errorHandler.test.ts's identical header
// for the full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- here it strips the return
// type of the hand-rolled mock `res` object's methods, leaving `res.body`
// typed as possibly-undefined/`res.status` as missing and failing to
// compile. Correctness is independently confirmed via real type-checking
// with `npx tsc -b` over the whole project (see task-23-report.md), which
// has no such pragma and fully type-checks validate.ts itself.
//
// Task 23: unit tests for the Zod-based request-validation middleware.
// Tested directly as a plain function against mock req/res/next objects,
// matching this codebase's established pattern for middleware tests (see
// errorHandler.test.ts) -- no need for a real Express app or an HTTP
// server, since `validate()` only depends on the (req, res, next)
// arguments Express hands any middleware.
//
// TDD: written before server/src/middleware/validate.ts exists (RED),
// then implemented to GREEN -- see task-23-report.md for the transcript.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validate, type ValidatedRequest } from './validate';

function makeRes(): any {
  const res: any = { statusCode: undefined, body: undefined };
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

test('validate() calls next() and attaches the parsed body on valid input', () => {
  const schema = z.object({ name: z.string(), age: z.number() });
  const middleware = validate({ body: schema });
  const req: any = { body: { name: 'Alice', age: 30 }, params: {}, query: {} };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, true, 'valid input must call next() so the route handler runs');
  assert.equal(res.statusCode, undefined, 'must not send a response on success');
  assert.deepEqual((req as ValidatedRequest).validated.body, { name: 'Alice', age: 30 });
});

test('validate() makes handlers consume the VALIDATED value: req.body is overwritten with the parsed/coerced data, not left as raw input', () => {
  // Zod default + coercion: raw input omits `enabled` and sends a numeric
  // string for `retries` -- the parsed value must reflect both the default
  // and the coercion, and req.body itself (not just req.validated.body)
  // must be replaced with that parsed value. This is the check that makes
  // validation load-bearing rather than decorative -- see task-23-brief.md.
  const schema = z.object({
    enabled: z.boolean().default(true),
    retries: z.coerce.number(),
  });
  const middleware = validate({ body: schema });
  const req: any = { body: { retries: '3' }, params: {}, query: {} };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, true);
  assert.deepEqual(req.body, { enabled: true, retries: 3 }, 'req.body itself must be the parsed/coerced value');
  assert.deepEqual((req as ValidatedRequest).validated.body, { enabled: true, retries: 3 });
});

test('validate() responds 400 and does NOT call next() (handler never reached) when the body fails validation', () => {
  const schema = z.object({ name: z.string() });
  const middleware = validate({ body: schema });
  const req: any = { body: { name: 123 }, params: {}, query: {} };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, false, 'the downstream handler must never be called on invalid input');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(typeof res.body.error, 'string');
  assert.ok(res.body.error.length > 0);
  assert.ok(Array.isArray(res.body.issues));
  assert.ok(res.body.issues.length > 0);
});

test('validate() 400 error shape is curated and does not leak raw Zod internals', () => {
  const schema = z.object({ name: z.string(), count: z.number() });
  const middleware = validate({ body: schema });
  const req: any = { body: { name: 123, count: 'nope' }, params: {}, query: {} };
  const res = makeRes();

  middleware(req, res, (() => {}) as any);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(Object.keys(res.body).sort(), ['code', 'error', 'issues']);
  assert.ok(res.body.issues.length >= 2, 'both failing fields should be reported');
  for (const issue of res.body.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ['message', 'path']);
    assert.equal(typeof issue.path, 'string', "path must be a flattened string, not Zod's raw (string|number)[] tuple");
    assert.equal(typeof issue.message, 'string');
  }
  const serialized = JSON.stringify(res.body);
  // Zod's raw issue objects carry a `code` (e.g. "invalid_type") and often
  // `expected`/`received` keys on EACH issue -- those must not survive into
  // the curated shape (the top-level `code` field is our own
  // "VALIDATION_ERROR" constant, not Zod's per-issue code).
  assert.ok(!serialized.includes('invalid_type'), 'must not leak Zod issue codes');
  assert.ok(!serialized.includes('"expected"'), 'must not leak Zod internals');
});

test('validate() validates params independently of body', () => {
  const paramsSchema = z.object({ id: z.string().uuid() });
  const middleware = validate({ params: paramsSchema });
  const req: any = { body: { anything: 'ignored, no body schema' }, params: { id: 'not-a-uuid' }, query: {} };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test('validate() with no schemas provided always calls next() and leaves req untouched', () => {
  const middleware = validate({});
  const req: any = { body: { anything: true }, params: { id: '1' }, query: {} };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, undefined);
  assert.deepEqual(req.body, { anything: true });
});

test('validate() aggregates issues from both body and params when both fail', () => {
  const middleware = validate({
    body: z.object({ name: z.string() }),
    params: z.object({ id: z.string().uuid() }),
  });
  const req: any = { body: { name: 42 }, params: { id: 'bad' }, query: {} };
  const res = makeRes();

  middleware(req, res, (() => {}) as any);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.issues.length >= 2, 'issues from both the body and params failures should be reported together');
});

test('validate() attaches coerced query to req.validated.query without reassigning req.query (Express 5 defines req.query as a read-only getter)', () => {
  const schema = z.object({ page: z.coerce.number() });
  const middleware = validate({ query: schema });
  const req: any = { body: {}, params: {}, query: { page: '2' } };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, true);
  assert.equal((req as ValidatedRequest).validated.query.page, 2, 'coerced to a number');
});

test('validate() rejects invalid query input with 400 and does not call next()', () => {
  const schema = z.object({ page: z.coerce.number() });
  const middleware = validate({ query: schema });
  const req: any = { body: {}, params: {}, query: { page: 'not-a-number' } };
  const res = makeRes();
  let nextCalled = false;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as any);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});
