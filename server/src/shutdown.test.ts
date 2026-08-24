// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's inline fake
// dependency objects (closures capturing a shared `calls`/`errors` array)
// hit the same bug. Correctness is independently confirmed with real
// type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/shutdown.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `shutdown.ts` file, which has no
// such pragma and is fully type-checked.
//
// Task 27, Part 2: server/src/shutdown.ts's gracefulShutdown() sequence --
// every dependency (http server, SSE close, WS disconnect, watchdog stop,
// db close, exit) is injected as a fake, so this never touches a real
// server/socket/db and never waits on the real 10s hard timeout (each test
// passes a `timeoutMs` on the order of tens of ms instead).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gracefulShutdown } from './shutdown';

function makeLogger() {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      info: (m: string) => infos.push(m),
      error: (m: string) => errors.push(m),
    },
    infos,
    errors,
  };
}

test('gracefulShutdown runs every cleanup step in the documented order, then exits 0', async () => {
  const calls: string[] = [];
  const { logger } = makeLogger();

  await gracefulShutdown({
    httpServer: {
      close: (cb) => {
        calls.push('http.close');
        cb?.();
      },
    },
    closeSse: () => {
      calls.push('sse.close');
    },
    disconnectSnapcastLive: () => {
      calls.push('ws.disconnect');
    },
    stopWatchdog: () => {
      calls.push('watchdog.stop');
    },
    closeDb: () => {
      calls.push('db.close');
    },
    exit: (code: number) => calls.push(`exit(${code})`),
    timeoutMs: 1000,
    logger,
  });

  assert.deepEqual(calls, [
    'http.close',
    'sse.close',
    'ws.disconnect',
    'watchdog.stop',
    'db.close',
    'exit(0)',
  ]);
});

test('gracefulShutdown continues remaining steps and still exits 0 when one step throws', async () => {
  const calls: string[] = [];
  const { logger, errors } = makeLogger();

  await gracefulShutdown({
    httpServer: { close: (cb) => cb?.() },
    closeSse: () => {
      calls.push('sse');
      throw new Error('sse boom');
    },
    disconnectSnapcastLive: () => {
      calls.push('ws');
    },
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    closeDb: () => {
      calls.push('db');
    },
    exit: (code: number) => calls.push(`exit(${code})`),
    timeoutMs: 1000,
    logger,
  });

  assert.deepEqual(calls, ['sse', 'ws', 'watchdog', 'db', 'exit(0)']);
  assert.ok(errors.some((e) => e.includes('sse boom')), 'the thrown error must be logged');
});

test('gracefulShutdown continues remaining steps when an ASYNC step rejects', async () => {
  const calls: string[] = [];
  const { logger, errors } = makeLogger();

  await gracefulShutdown({
    httpServer: { close: (cb) => cb?.() },
    closeSse: () => {
      calls.push('sse');
    },
    disconnectSnapcastLive: async () => {
      calls.push('ws');
      throw new Error('ws boom');
    },
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    closeDb: () => {
      calls.push('db');
    },
    exit: (code: number) => calls.push(`exit(${code})`),
    timeoutMs: 1000,
    logger,
  });

  assert.deepEqual(calls, ['sse', 'ws', 'watchdog', 'db', 'exit(0)']);
  assert.ok(errors.some((e) => e.includes('ws boom')));
});

test('gracefulShutdown force-exits with code 1 if a cleanup step hangs past the timeout, and skips the remaining steps', async () => {
  const calls: string[] = [];
  const { logger, errors } = makeLogger();
  let exitCode: number | undefined;

  // Deliberately not awaited -- closeSse never resolves, so the returned
  // promise from gracefulShutdown() itself never settles either. The test
  // instead waits on the timeout's own exit() call.
  void gracefulShutdown({
    httpServer: { close: (cb) => cb?.() },
    closeSse: () => new Promise(() => {}), // hangs forever
    disconnectSnapcastLive: () => {
      calls.push('ws'); // must never run -- the sequence never gets past the hung step
    },
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    closeDb: () => {
      calls.push('db');
    },
    exit: (code: number) => {
      exitCode = code;
    },
    timeoutMs: 30, // much shorter than production's 10s -- see this file's header
    logger,
  });

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(exitCode, 1);
  assert.ok(errors.some((e) => e.includes('did not complete')));
  assert.deepEqual(calls, [], 'steps after the hung one must never run');
});

test('gracefulShutdown never force-exits a second time after completing normally before the timeout', async () => {
  const { logger, errors } = makeLogger();
  const exitCodes: number[] = [];

  await gracefulShutdown({
    httpServer: { close: (cb) => cb?.() },
    closeSse: () => {},
    disconnectSnapcastLive: () => {},
    stopWatchdog: () => {},
    closeDb: () => {},
    exit: (code: number) => exitCodes.push(code),
    timeoutMs: 30,
    logger,
  });

  // Let the timeout's own window fully elapse -- it must not fire a second exit(1).
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(exitCodes, [0]);
  assert.equal(errors.length, 0);
});

test('gracefulShutdown logs (but tolerates) an error reported via the http.close callback', async () => {
  const { logger, errors } = makeLogger();
  const exitCodes: number[] = [];

  await gracefulShutdown({
    httpServer: {
      close: (cb) => cb?.(new Error('already closed')),
    },
    closeSse: () => {},
    disconnectSnapcastLive: () => {},
    stopWatchdog: () => {},
    closeDb: () => {},
    exit: (code: number) => exitCodes.push(code),
    timeoutMs: 1000,
    logger,
  });

  assert.deepEqual(exitCodes, [0]);
  assert.ok(errors.some((e) => e.includes('already closed')));
});
