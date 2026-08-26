// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/auth.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw
// `fetch()` response bodies hit the same issue. Does not affect
// `npm run build` or the production route file, neither of which have
// this pragma.
//
// Task 57 (Stage 5, item 5.1): health-check endpoint tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';

// Matches auth.test.ts's exact pattern: this MUST run before `./health` is
// imported below (which transitively imports `../auth`, whose module-level
// resolveJwtSecret() reads process.env.JWT_SECRET exactly once, at import
// time) -- these test files compile to CommonJS with position-preserving
// require()s (not hoisted like true ESM imports), so this line genuinely
// executes before the import statement that follows it.
process.env.JWT_SECRET = 'test-only-fixed-secret-for-health-test-ts';

import healthRouter from './health';
import db from '../database';
import { configService } from '../services/config';
import { snapcastLive } from '../services/snapcastLive';

const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
app.use(express.json());
app.use('/api', healthRouter);

let server: http.Server;
let baseUrl = '';

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getJson(urlPath: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function makeToken() {
  return jwt.sign({ id: 1, username: 'admin', role: 'admin', tokenVersion: 0 }, JWT_SECRET!, { expiresIn: '1h' });
}

test('GET /api/health returns 200 {status: ok} when the DB is reachable', async () => {
  const { status, body } = await getJson('/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok' });
});

test('GET /api/health returns 503 when the DB check fails', async () => {
  const original = db.prepare;
  // @ts-expect-error -- deliberately breaking the DB check for this one test
  db.prepare = () => { throw new Error('simulated DB failure'); };
  try {
    const { status, body } = await getJson('/api/health');
    assert.equal(status, 503);
    assert.equal(body.status, 'error');
    assert.ok(body.error);
  } finally {
    db.prepare = original;
  }
});

test('GET /api/health/detail without a token returns 401', async () => {
  const { status } = await getJson('/api/health/detail');
  assert.equal(status, 401);
});

test('GET /api/health/detail with a valid token returns 200 with all 5 checks present', async () => {
  const { status, body } = await getJson('/api/health/detail', makeToken());
  assert.equal(status, 200);
  assert.equal(typeof body.snapserver.systemdActive, 'boolean');
  assert.equal(typeof body.snapserver.rpcConnected, 'boolean');
  assert.ok('config' in body);
  assert.ok('disk' in body);
  assert.equal(typeof body.permissions.snapshotsDirWritable, 'boolean');
});

test('GET /api/health/detail: one failing check does not prevent the others from reporting', async () => {
  const original = configService.readServerConfigParsed;
  configService.readServerConfigParsed = async () => { throw new Error('simulated config parse failure'); };
  try {
    const { status, body } = await getJson('/api/health/detail', makeToken());
    assert.equal(status, 200);
    assert.equal(body.config.parseable, false);
    assert.ok(body.config.error);
    // The OTHER checks still ran and reported real values, not just "the
    // whole endpoint fell over because one dependency threw."
    assert.equal(typeof body.snapserver.systemdActive, 'boolean');
    assert.equal(typeof body.permissions.snapshotsDirWritable, 'boolean');
  } finally {
    configService.readServerConfigParsed = original;
  }
});

test('GET /api/health/detail: snapcastLive.isConnected reflects the real getter, not a hardcoded value', async () => {
  const { body: bodyDisconnected } = await getJson('/api/health/detail', makeToken());
  assert.equal(bodyDisconnected.snapserver.rpcConnected, false); // no real WS connection in this test process

  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(snapcastLive), 'isConnected');
  Object.defineProperty(snapcastLive, 'isConnected', { get: () => true, configurable: true });
  try {
    const { body } = await getJson('/api/health/detail', makeToken());
    assert.equal(body.snapserver.rpcConnected, true);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.getPrototypeOf(snapcastLive), 'isConnected', originalDescriptor);
    }
    delete (snapcastLive as any).isConnected;
  }
});
