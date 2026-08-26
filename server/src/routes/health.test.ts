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
import * as path from 'path';
import * as os from 'os';

// Matches auth.test.ts's and services/pipeSources.test.ts's exact pattern:
// this MUST run before `./health` is imported below (which transitively
// imports `../auth` and `../database`, whose module-level side effects --
// resolveJwtSecret() reading process.env.JWT_SECRET, and the better-sqlite3
// singleton reading process.env.DB_PATH -- run exactly once, at import
// time) -- these test files compile to CommonJS with position-preserving
// require()s (not hoisted like true ESM imports), so these lines genuinely
// execute before the import statements that follow them.
//
// DB_PATH: fixed during Task 57's review (Task 58 review, Finding 1). This
// file previously imported the real, shared `../database` singleton without
// isolating it to a fresh file (unlike auth.test.ts / pipeSources.test.ts),
// so it ran against whatever dev DB happened to be on disk -- which is also
// why the id:1 bug below went unnoticed: a leftover user row from manual
// testing/other runs happened to satisfy it. `node --test` runs each test
// file in its own process, so a fresh temp file here never collides with
// the real app DB or with other test files.
process.env.DB_PATH = path.join(os.tmpdir(), `health-test-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-only-fixed-secret-for-health-test-ts';

import healthRouter from './health';
import db from '../database';
import { configService } from '../services/config';
import { snapcastLive } from '../services/snapcastLive';
import * as metrics from '../services/metrics';

const JWT_SECRET = process.env.JWT_SECRET;

// Fixed during Task 57's review (Task 58 review, Finding 1): makeToken()
// below signs a JWT for this id, and authenticateToken (server/src/auth.ts)
// looks that id up in the REAL `users` table, returning 403 if no row
// matches. Previously the id (1) was hardcoded and no matching row was ever
// inserted -- it only "worked" by accident when a shared/leftover DB
// happened to already contain a user with id 1. Seeding a real row here
// (against the fresh, isolated DB_PATH above) and using its real,
// database-assigned id makes this file self-contained and correct
// regardless of execution order or shared DB state.
const ADMIN_ID = Number(
  db
    .prepare('INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, 0)')
    .run('admin', 'unused-test-password-hash', 'admin').lastInsertRowid,
);

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
  return jwt.sign({ id: ADMIN_ID, username: 'admin', role: 'admin', tokenVersion: 0 }, JWT_SECRET!, { expiresIn: '1h' });
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

// Task 64 (Stage 5, item 5.7): local metrics -- uptime, jobs executed,
// errors per endpoint, added to /health/detail's response.
test('GET /api/health/detail: metrics field is present with the right shape', async () => {
  const { status, body } = await getJson('/api/health/detail', makeToken());
  assert.equal(status, 200);
  assert.ok('metrics' in body);
  assert.equal(typeof body.metrics.uptimeSeconds, 'number');
  assert.ok(body.metrics.uptimeSeconds >= 0);
  assert.equal(typeof body.metrics.jobsExecuted, 'number');
  assert.ok(Array.isArray(body.metrics.errorsByEndpoint));
});

test('GET /api/health/detail: a failure computing jobsExecuted degrades gracefully without breaking uptime, errorsByEndpoint, or the 4 pre-existing checks', async () => {
  // Mirrors this file's own configService.readServerConfigParsed mocking
  // pattern above -- getJobsExecuted is a plain exported function called as
  // `metrics_1.getJobsExecuted()` under this project's CommonJS test
  // compilation, so reassigning it on the same required module object
  // affects health.ts's call site exactly like reassigning
  // configService's method affects its own call site.
  const original = metrics.getJobsExecuted;
  metrics.getJobsExecuted = () => {
    throw new Error('simulated jobs count failure');
  };
  try {
    const { status, body } = await getJson('/api/health/detail', makeToken());
    assert.equal(status, 200);
    assert.equal(body.metrics.jobsExecuted, null);
    assert.ok(body.metrics.jobsExecutedError);

    // The OTHER new metrics, and all 4 pre-existing checks, still reported
    // real values -- one failing computation didn't take the rest down.
    assert.equal(typeof body.metrics.uptimeSeconds, 'number');
    assert.ok(Array.isArray(body.metrics.errorsByEndpoint));
    assert.equal(typeof body.snapserver.systemdActive, 'boolean');
    assert.ok('config' in body);
    assert.ok('disk' in body);
    assert.equal(typeof body.permissions.snapshotsDirWritable, 'boolean');
  } finally {
    metrics.getJobsExecuted = original;
  }
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
