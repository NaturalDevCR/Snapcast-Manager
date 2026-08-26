// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see routes/health.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw fetch()
// response bodies hit the same issue. Does not affect `npm run build` or
// the production route file, neither of which have this pragma.
//
// Task 62 (Stage 5, item 5.5, part 1/2): GET /api/diagnostics route test.
// Follows routes/health.test.ts's exact pattern for testing an
// authenticated route: a real express app + http.Server on an ephemeral
// port, a JWT signed for a real seeded user row, plain fetch().
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import * as path from 'path';
import * as os from 'os';

// Must run before `./diagnostics` is imported below -- see health.test.ts's
// identical comment for why (position-preserving require()s under
// `node --test --import ts-node/register`, not hoisted like true ESM).
process.env.DB_PATH = path.join(os.tmpdir(), `diagnostics-route-test-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-only-fixed-secret-for-diagnostics-route-test-ts';

import diagnosticsRouter from './diagnostics';
import db from '../database';

const JWT_SECRET = process.env.JWT_SECRET;

const ADMIN_ID = Number(
  db
    .prepare('INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, 0)')
    .run('admin', 'unused-test-password-hash', 'admin').lastInsertRowid,
);

const app = express();
app.use(express.json());
app.use('/api', diagnosticsRouter);

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

test('GET /api/diagnostics without a token returns 401', async () => {
  const { status } = await getJson('/api/diagnostics');
  assert.equal(status, 401);
});

test('GET /api/diagnostics with a valid token returns 200 with { findings: [] }', async () => {
  const { status, body } = await getJson('/api/diagnostics', makeToken());
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.findings));
  // Whatever findings this dev/CI environment happens to produce (systemd
  // unlikely to even be present), every entry present must have the
  // documented shape.
  for (const finding of body.findings) {
    assert.equal(typeof finding.id, 'string');
    assert.ok(['unmanaged-config', 'orphaned-unit', 'fifo-no-producer', 'snapserver-down', 'port-occupied'].includes(finding.category));
    assert.ok(['info', 'warning', 'error'].includes(finding.severity));
    assert.equal(typeof finding.message, 'string');
  }
});
