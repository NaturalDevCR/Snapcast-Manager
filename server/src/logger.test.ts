// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's `envWith()`
// helper and `collectingStream()`'s captured array hit the same bug.
// Correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/logger.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `logger.ts` file, which has no
// such pragma and is fully type-checked.
//
// Task 27, Part 1: tests server/src/logger.ts's OWN configuration
// (level-from-env rules, redaction) -- not pino's internals, which are
// already well-tested upstream. `buildLoggerOptions()` is a pure function
// of an env-var bag, so level rules are asserted directly against its
// return value with no real logger/process-env mutation needed. Redaction
// is asserted against a REAL pino instance built from those options,
// writing into an in-memory stream, because `fast-redact`'s path syntax
// (`*.password`, etc.) is exactly the kind of thing that's easy to get
// subtly wrong and worth proving end-to-end rather than trusting by
// inspection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'stream';
import pino from 'pino';
import { buildLoggerOptions } from './logger';

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

test('buildLoggerOptions: defaults to "info" when NODE_ENV=production and LOG_LEVEL is unset', () => {
  const opts = buildLoggerOptions(envWith({ NODE_ENV: 'production' }));
  assert.equal(opts.level, 'info');
});

test('buildLoggerOptions: defaults to "debug" when NODE_ENV is not production', () => {
  assert.equal(buildLoggerOptions(envWith({ NODE_ENV: 'development' })).level, 'debug');
  assert.equal(buildLoggerOptions(envWith({ NODE_ENV: 'test' })).level, 'debug');
  assert.equal(buildLoggerOptions(envWith({})).level, 'debug'); // NODE_ENV unset
});

test('buildLoggerOptions: LOG_LEVEL always overrides the NODE_ENV-based default', () => {
  assert.equal(buildLoggerOptions(envWith({ NODE_ENV: 'production', LOG_LEVEL: 'warn' })).level, 'warn');
  assert.equal(buildLoggerOptions(envWith({ NODE_ENV: 'development', LOG_LEVEL: 'error' })).level, 'error');
});

/** Collects every line pino writes into this stream, parsed as JSON. */
function collectingStream(): { stream: Writable; lines: () => any[] } {
  const raw: string[] = [] as string[];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      raw.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    lines: () => raw.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
  };
}

test('logger config redacts top-level secret-shaped fields', () => {
  const opts = buildLoggerOptions(envWith({ NODE_ENV: 'production' }));
  const { stream, lines } = collectingStream();
  const testLogger = pino(opts, stream);

  testLogger.info(
    { password: 'hunter2', token: 'abc.def.ghi', safe: 'this-is-fine' },
    'test message',
  );

  const [line] = lines();
  assert.equal(line.password, '[REDACTED]');
  assert.equal(line.token, '[REDACTED]');
  assert.equal(line.safe, 'this-is-fine');
  assert.equal(line.msg, 'test message');
});

test('logger config redacts one level of nested secret-shaped fields', () => {
  const opts = buildLoggerOptions(envWith({ NODE_ENV: 'production' }));
  const { stream, lines } = collectingStream();
  const testLogger = pino(opts, stream);

  testLogger.info({ req: { headers: { authorization: 'Bearer abc.def.ghi' } }, user: { password: 'inner-secret' } }, 'nested');

  const [line] = lines();
  assert.equal(line.req.headers.authorization, '[REDACTED]');
  assert.equal(line.user.password, '[REDACTED]');
});

test('logger config never redacts a field that merely CONTAINS a secret-shaped substring in its name', () => {
  const opts = buildLoggerOptions(envWith({ NODE_ENV: 'production' }));
  const { stream, lines } = collectingStream();
  const testLogger = pino(opts, stream);

  testLogger.info({ passwordPolicyDescription: 'min 12 chars' }, 'not a secret field');

  const [line] = lines();
  assert.equal(line.passwordPolicyDescription, 'min 12 chars');
});
