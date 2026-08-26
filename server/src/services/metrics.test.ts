// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/auth.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw
// `fetch()` response bodies (in the middleware section) hit the same
// issue. Does not affect `npm run build` or the production
// `services/metrics.ts` file, which has no such pragma.
//
// Task 64 (Stage 5, item 5.7): local metrics -- uptime, jobs executed,
// errors per endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import * as path from 'path';
import * as os from 'os';

import { runMigrations } from '../database/migrations';

// DB_PATH/JWT_SECRET MUST be set before `./metrics` (or anything else that
// transitively imports '../database'/'../auth') is imported below -- exact
// same rule routes/health.test.ts documents at its own top: these test
// files compile to CommonJS with position-preserving require()s (not
// hoisted like true ESM imports), so these lines genuinely execute before
// the import statements that follow them. '../database/migrations' above
// is safe to import early -- it's migrations.ts that database.ts imports,
// not the other way around, so it never touches the real DB singleton.
process.env.DB_PATH = path.join(os.tmpdir(), `metrics-test-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-only-fixed-secret-for-metrics-test-ts';

import { getUptimeSeconds, getJobsExecuted, ErrorMetricsTracker, trackEndpointErrors, errorMetrics, UNMATCHED_ROUTE_BUCKET } from './metrics';
import pipeSourcesRouter from '../routes/pipeSources';
import db from '../database';

function freshDb(): Database.Database {
  const memDb = new Database(':memory:');
  runMigrations(memDb);
  return memDb;
}

// ---- uptime ----

test('getUptimeSeconds(): returns a non-negative whole number of seconds', () => {
  const uptime = getUptimeSeconds();
  assert.equal(typeof uptime, 'number');
  assert.ok(uptime >= 0, 'uptime must never be negative');
  assert.equal(Number.isInteger(uptime), true, 'rounded to whole seconds');
});

test('getUptimeSeconds(): reflects process.uptime(), not a hardcoded value', () => {
  const original = process.uptime;
  // @ts-expect-error -- deliberately stubbing a Node built-in for a deterministic assertion
  process.uptime = () => 12345.6;
  try {
    assert.equal(getUptimeSeconds(), 12346); // Math.round(12345.6)
  } finally {
    process.uptime = original;
  }
});

// ---- jobs executed ----

test('getJobsExecuted(): counts every row in the jobs table regardless of status', () => {
  const memDb = freshDb();
  assert.equal(getJobsExecuted(memDb), 0, 'starts at 0 against a fresh, empty jobs table');

  const insert = memDb.prepare(
    `INSERT INTO jobs (id, label, status, log, output, error, started_at, finished_at)
     VALUES (@id, @label, @status, '[]', NULL, @error, @startedAt, @finishedAt)`,
  );
  insert.run({ id: 'job-1', label: 'Install snapserver', status: 'done', error: null, startedAt: 1, finishedAt: 2 });
  insert.run({ id: 'job-2', label: 'Update packages', status: 'error', error: 'boom', startedAt: 3, finishedAt: 4 });
  insert.run({
    id: 'job-3',
    label: 'Interrupted install',
    status: 'interrupted',
    error: 'restarted mid-job',
    startedAt: 5,
    finishedAt: 6,
  });

  // A job that errored or was interrupted by a restart still genuinely
  // executed -- the count is NOT filtered to status = 'done' only.
  assert.equal(getJobsExecuted(memDb), 3);
});

// ---- error-per-endpoint tracker (Express-independent) ----

test('ErrorMetricsTracker: records and snapshots counts per (method, path)', () => {
  const tracker = new ErrorMetricsTracker();
  tracker.record('GET', '/api/foo');
  tracker.record('GET', '/api/foo');
  tracker.record('POST', '/api/bar');

  const snapshot = tracker.snapshot();
  assert.deepEqual(snapshot, [
    { method: 'GET', path: '/api/foo', count: 2 },
    { method: 'POST', path: '/api/bar', count: 1 },
  ]);
});

test('ErrorMetricsTracker: snapshot is sorted highest-count-first', () => {
  const tracker = new ErrorMetricsTracker();
  tracker.record('GET', '/api/rare');
  tracker.record('GET', '/api/common');
  tracker.record('GET', '/api/common');
  tracker.record('GET', '/api/common');

  const snapshot = tracker.snapshot();
  assert.equal(snapshot[0].path, '/api/common');
  assert.equal(snapshot[0].count, 3);
  assert.equal(snapshot[1].path, '/api/rare');
  assert.equal(snapshot[1].count, 1);
});

// ---- trackEndpointErrors middleware, against a real Express app ----

const ADMIN_ID = Number(
  db
    .prepare('INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, 0)')
    .run('admin', 'unused-test-password-hash', 'admin').lastInsertRowid,
);

function makeToken() {
  return jwt.sign(
    { id: ADMIN_ID, username: 'admin', role: 'admin', tokenVersion: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

const app = express();
app.use(express.json());
app.use(trackEndpointErrors);
app.use('/api/pipe-sources', pipeSourcesRouter);
// A plain, unmatched-route path -- exercises the req.route === undefined
// fallback branch (UNMATCHED_ROUTE_BUCKET) in trackEndpointErrors.
app.use('/api/unknown-thing', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});
// Mirrors index.ts's real `/api` catch-all EXACTLY (app.use('/api', fn), a
// plain middleware, not a router.METHOD route) -- this is the actual
// unbounded-growth vector the review caught: req.route is undefined here,
// and the tail after `/api` is attacker-controlled.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});

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

async function postControl(id: string, token: string) {
  const res = await fetch(`${baseUrl}/api/pipe-sources/${id}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'start' }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

test('trackEndpointErrors: a 2xx response is not counted', async () => {
  errorMetrics.reset();
  const token = makeToken();
  const res = await fetch(`${baseUrl}/api/pipe-sources`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);

  const snapshot = errorMetrics.snapshot();
  assert.equal(
    snapshot.find((e: any) => e.path === '/api/pipe-sources/'),
    undefined,
    '2xx responses must not appear in the error snapshot',
  );
});

test('trackEndpointErrors: an unauthenticated request (401) IS counted -- not just errorHandler-routed failures', async () => {
  // A 401 from router.use(authenticateToken) (routes/pipeSources.ts:22)
  // short-circuits BEFORE Express reaches the specific router.get('/')
  // layer, so req.route is undefined here too -- but req.baseUrl
  // ('/api/pipe-sources') is still real, fixed, and bounded, so it's
  // tracked on its own (see trackEndpointErrors' own doc comment for why
  // this must NOT collapse into one indistinct bucket the way a genuinely
  // unmatched `/api/<random>` request does).
  errorMetrics.reset();
  const res = await fetch(`${baseUrl}/api/pipe-sources`);
  assert.equal(res.status, 401);

  const snapshot = errorMetrics.snapshot();
  const entry = snapshot.find((e: any) => e.method === 'GET' && e.path === '/api/pipe-sources');
  assert.ok(
    entry,
    'a 401 handled entirely by local middleware (authenticateToken), never reaching errorHandler.ts, must still be counted',
  );
  assert.equal(entry.count, 1);
});

test('trackEndpointErrors: TWO different resource ids hitting the SAME parameterized route collapse into ONE entry, not two', async () => {
  errorMetrics.reset();
  const token = makeToken();

  const first = await postControl('nonexistent-id-aaaa', token);
  const second = await postControl('nonexistent-id-bbbb', token);

  // Both ids are real-shaped but don't correspond to an actual pipe source
  // -- pipeSourceService.control() throws "not found", which the route's
  // own try/catch maps to a 500. Confirms the failure is genuinely
  // exercised (not e.g. silently 200ing) before checking the metric below.
  assert.equal(first.status, 500);
  assert.equal(second.status, 500);

  const snapshot = errorMetrics.snapshot();
  const matching = snapshot.filter((e: any) => e.method === 'POST' && /\/control$/.test(e.path));
  assert.equal(
    matching.length,
    1,
    'exactly one tracked entry for the parameterized route, regardless of which id was used',
  );

  const entry = matching[0];
  // The path must be the NORMALIZED pattern-form route, not either raw URL.
  assert.equal(entry.path, '/api/pipe-sources/:id/control');
  assert.notEqual(entry.path, '/api/pipe-sources/nonexistent-id-aaaa/control');
  assert.notEqual(entry.path, '/api/pipe-sources/nonexistent-id-bbbb/control');
  assert.equal(entry.count, 2, 'both requests (different ids, same route) counted against the one entry');
});

test('trackEndpointErrors: an unmatched route (no req.route) still gets tracked, under its real (bounded) req.baseUrl', async () => {
  errorMetrics.reset();
  const res = await fetch(`${baseUrl}/api/unknown-thing`);
  assert.equal(res.status, 404);

  const snapshot = errorMetrics.snapshot();
  // req.route is undefined here (this is a plain app.use() middleware, not
  // a router.get()/post() route) -- falls back to req.baseUrl alone
  // ('/api/unknown-thing', the FIXED mount prefix, never the
  // attacker-controlled tail after it -- see the fix below).
  const entry = snapshot.find((e: any) => e.method === 'GET' && e.path === '/api/unknown-thing');
  assert.ok(entry, 'a request that never matches a router-registered route (req.route undefined) is still tracked, under its bounded baseUrl');
  assert.equal(entry.count, 1);
});

test('trackEndpointErrors: unmatched requests with DIFFERENT attacker-controlled paths collapse into ONE bounded bucket, not one entry per path', async () => {
  // Regression test for a real gap the Task 64 review caught: the original
  // fallback used `req.baseUrl + req.path`, which for index.ts's real `/api`
  // catch-all (app.use('/api', fn), not a router route) is `'/api' +
  // <attacker-controlled tail>` -- an unauthenticated caller hitting many
  // distinct nonexistent /api/<random> paths could grow the in-memory Map
  // without bound. `req.path` is now never concatenated at all -- the whole
  // unmatched-route key space must stay bounded to exactly ONE entry (keyed
  // by the catch-all's own fixed baseUrl, '/api'), regardless of how many
  // distinct nonexistent paths are requested.
  errorMetrics.reset();
  const junkPaths = ['/api/scanner-probe-aaaa', '/api/totally-different-bbbb', '/api/yet-another-one-cccc'];
  for (const p of junkPaths) {
    const res = await fetch(`${baseUrl}${p}`);
    assert.equal(res.status, 404);
  }

  const snapshot = errorMetrics.snapshot();
  const unmatchedEntries = snapshot.filter((e: any) => e.path === '/api' && e.method === 'GET');
  assert.equal(unmatchedEntries.length, 1, 'exactly one collapsed entry, not one per distinct attacker path');
  assert.equal(unmatchedEntries[0].count, junkPaths.length);
  // None of the raw attacker-supplied paths leaked into the Map as their
  // own key -- the bounded-bucket fix, not just a coincidentally-low count.
  for (const p of junkPaths) {
    assert.ok(!snapshot.some((e: any) => e.path === p), `raw attacker path "${p}" must not appear as its own tracked entry`);
  }
});

test('trackEndpointErrors: a path-less app.use() middleware (empty req.baseUrl) falls back to the fixed UNMATCHED_ROUTE_BUCKET, never an empty-string key', async () => {
  // Mirrors index.ts's SPA-fallback middleware shape (`app.use((req, res)
  // => ...)`, no mount path at all) -- req.baseUrl is '' there, so the
  // req.baseUrl-alone fallback would otherwise track an empty-string key.
  const spaApp = express();
  spaApp.use(trackEndpointErrors);
  spaApp.use((_req, res) => {
    res.status(500).send('simulated failure with no matched route or baseUrl');
  });
  const spaServer = spaApp.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => spaServer.once('listening', resolve));
    const addr = spaServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    errorMetrics.reset();
    const res = await fetch(`http://127.0.0.1:${port}/whatever/path-here`);
    assert.equal(res.status, 500);

    const snapshot = errorMetrics.snapshot();
    assert.ok(
      snapshot.some((e: any) => e.path === UNMATCHED_ROUTE_BUCKET),
      'an empty req.baseUrl must fall back to the fixed bucket constant, not an empty-string or attacker-controlled key',
    );
    assert.ok(!snapshot.some((e: any) => e.path === ''), 'must never track an empty-string path key');
  } finally {
    spaServer.close();
  }
});
