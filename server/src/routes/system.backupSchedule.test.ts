// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see routes/health.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw fetch()
// response bodies hit the same issue. Does not affect `npm run build` or
// the production route file, neither of which have this pragma.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import * as path from 'path';
import * as os from 'os';

// Must run before `./system` is imported below -- routes/system.ts
// transitively imports ../database (DB_PATH) and ../auth (JWT_SECRET) at
// module-load time. Same ordering as health.test.ts/diagnostics.test.ts.
process.env.DB_PATH = path.join(os.tmpdir(), `system-backup-schedule-test-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-only-fixed-secret-for-system-backup-schedule-test-ts';

import systemRouter, { backupScheduleService } from './system';
import db from '../database';

const JWT_SECRET = process.env.JWT_SECRET;

const ADMIN_ID = Number(
  db
    .prepare('INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, 0)')
    .run('admin', 'unused-test-password-hash', 'admin').lastInsertRowid,
);

function makeToken(): string {
  return jwt.sign({ id: ADMIN_ID, username: 'admin', role: 'admin', tokenVersion: 0 }, JWT_SECRET!, { expiresIn: '1h' });
}

const app = express();
app.use(express.json());
app.use('/api/system', systemRouter);

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
  backupScheduleService.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function api(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

test('GET /api/system/backup-schedule returns the current config', async () => {
  const { status, body } = await api('GET', '/api/system/backup-schedule');
  assert.equal(status, 200);
  assert.equal(typeof body.enabled, 'boolean');
  assert.equal(typeof body.frequency, 'string');
});

test('PUT /api/system/backup-schedule validates and persists', async () => {
  const { status, body } = await api('PUT', '/api/system/backup-schedule', {
    enabled: true,
    frequency: 'daily',
    time: '04:15',
    retainCount: 4,
  });
  assert.equal(status, 200);
  assert.equal(body.time, '04:15');
  assert.equal(body.retainCount, 4);
});

test('PUT /api/system/backup-schedule rejects an invalid time with 400', async () => {
  const { status } = await api('PUT', '/api/system/backup-schedule', {
    enabled: true,
    frequency: 'daily',
    time: 'bad',
    retainCount: 4,
  });
  assert.equal(status, 400);
});

test('POST /api/system/backup-schedule/run-now triggers a scheduled backup', async () => {
  const original = backupScheduleService.runNow;
  let called = false;
  (backupScheduleService as any).runNow = async () => {
    called = true;
    return { path: '/tmp/x', fileName: 'scheduled-x.tar.gz', size: 1, timestamp: 'x', components: [], files: [] };
  };
  try {
    const { status } = await api('POST', '/api/system/backup-schedule/run-now');
    assert.equal(status, 200);
    assert.ok(called);
  } finally {
    (backupScheduleService as any).runNow = original;
  }
});
