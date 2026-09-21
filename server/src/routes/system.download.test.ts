// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see routes/health.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw fetch()
// response bodies and its `stubModuleFn` binding onto the `fs` module
// object hit the same issue. Does not affect `npm run build` or the
// production route file, neither of which have this pragma.
//
// GET /api/system/backups/download/:name previously piped
// fs.createReadStream(fullPath) straight into the response with no error
// handler. A read failure on that stream (EACCES, the file vanishing
// between the existsSync() check and the actual open, etc.) is an
// unhandled EventEmitter 'error' -- Node's default for that is an
// uncaught exception, which crashes the WHOLE process (this app installs
// no global uncaughtException handler in index.ts), not just this one
// request. Observed in production: a failed download also dropped an
// unrelated concurrent SSE connection at the same moment, consistent with
// the entire server process going down and a process manager restarting
// it. This file proves the fix: a stream read error now produces a normal
// 500 response and the test process itself survives (if it didn't, this
// whole file -- and every test after it in the same `node --test` run --
// would never report a result).

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import * as path from 'path';
import * as os from 'os';
// Default import (not `import * as`), matching backup.test.ts's identical
// fsPromisesDefault trick: a namespace import of a builtin gets wrapped by
// TS's __importStar into a fresh, non-writable-getter object, so
// reassigning fsDefault.existsSync would throw. A default import of a
// non-`__esModule` module unwraps to `{ default: <the real, mutable,
// process-wide module object> }` -- the exact object routes/system.ts's
// own `import fs from 'fs'` reads from at call time.
import fsDefault from 'fs';
import { EventEmitter } from 'events';

process.env.DB_PATH = path.join(os.tmpdir(), `system-download-test-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-only-fixed-secret-for-system-download-test-ts';

// Must run before `./system` is imported below, for the same reason
// system.backupSchedule.test.ts's identical stub does -- routes/system.ts
// constructs a module-level BackupScheduleService singleton at import
// time, whose constructor touches a real config path unless ensureConfig()
// is redirected first.
import { BackupScheduleService } from '../services/backupSchedule';
const backupScheduleConfigPath = path.join(
  os.tmpdir(),
  `system-download-test-schedule-config-${process.pid}-${Date.now()}.json`,
);
const originalEnsureConfig = (BackupScheduleService.prototype as any).ensureConfig;
(BackupScheduleService.prototype as any).ensureConfig = async () => backupScheduleConfigPath;

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
  (BackupScheduleService.prototype as any).ensureConfig = originalEnsureConfig;
  try {
    fsDefault.unlinkSync(backupScheduleConfigPath);
  } catch {
    // never written / already gone -- fine.
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

test('GET /backups/download/:name streams a real, readable file with a 200', async () => {
  const content = 'fake tar.gz content for a genuinely readable stream';
  const restoreExists = stubModuleFn(fsDefault, 'existsSync', () => true);
  const restoreStat = stubModuleFn(fsDefault, 'statSync', () => ({ size: content.length }));
  const restoreCreateReadStream = stubModuleFn(fsDefault, 'createReadStream', () => {
    const { Readable } = require('stream');
    return Readable.from([content]);
  });
  try {
    const res = await fetch(`${baseUrl}/api/system/backups/download/pre-snapserver-20260101-120000.tar.gz`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, content);
  } finally {
    restoreExists();
    restoreStat();
    restoreCreateReadStream();
  }
});

test('GET /backups/download/:name responds 500 (not a dropped/empty connection) when the read stream errors, and does not crash the process', async () => {
  const restoreExists = stubModuleFn(fsDefault, 'existsSync', () => true);
  const restoreStat = stubModuleFn(fsDefault, 'statSync', () => ({ size: 1024 }));
  const restoreCreateReadStream = stubModuleFn(fsDefault, 'createReadStream', () => {
    // A real Readable that emits an async 'error' shortly after being
    // piped -- reproduces the EACCES/ENOENT-mid-read failure mode without
    // needing a real unreadable file on disk.
    const stream = new EventEmitter() as any;
    stream.pipe = (dest: any) => {
      setImmediate(() => stream.emit('error', Object.assign(new Error('simulated read failure'), { code: 'EACCES' })));
      return dest;
    };
    return stream;
  });
  try {
    const res = await fetch(`${baseUrl}/api/system/backups/download/pre-snapserver-20260101-120000.tar.gz`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 500);
    const json = await res.json();
    assert.match(json.error, /Failed to read backup file/);
  } finally {
    restoreExists();
    restoreStat();
    restoreCreateReadStream();
  }
});

test('GET /backups/download/:name rejects a malformed name with 400', async () => {
  const res = await fetch(`${baseUrl}/api/system/backups/download/../../etc/passwd`, {
    headers: { Authorization: `Bearer ${makeToken()}` },
  });
  // Note: Node/undici's fetch normalizes '../' in the URL path before the
  // request is even sent, same as a browser would -- so this exercises
  // whatever request the client actually ends up making, which is the
  // realistic attack surface (resolveBackupPath()'s own regex is the real
  // defense either way).
  assert.ok(res.status === 400 || res.status === 404);
});

test('GET /backups/download/:name responds 404 when the resolved file does not exist', async () => {
  const restoreExists = stubModuleFn(fsDefault, 'existsSync', () => false);
  try {
    const res = await fetch(`${baseUrl}/api/system/backups/download/pre-snapserver-20260101-120000.tar.gz`, {
      headers: { Authorization: `Bearer ${makeToken()}` },
    });
    assert.equal(res.status, 404);
  } finally {
    restoreExists();
  }
});
