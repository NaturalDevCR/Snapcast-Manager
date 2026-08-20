// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw `fetch()`
// response bodies and better-sqlite3 row casts hit the same bug (types get
// stripped, leaving values typed `unknown`/`any` in ways that fail to
// compile under this runner even though they're fine at real build time).
// Correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/auth.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `auth.ts` file, which has no such
// pragma and is fully type-checked.
//
// Task 15: auth hardening tests -- password length policy, the persisted
// (SQLite-backed) login rate limiter across THREE endpoints, token_version
// invalidation end-to-end (including the "missing claim == version 0"
// backward-compat path), and POST /auth/logout.
//
// DB isolation: same pattern as services/pipeSources.test.ts -- set DB_PATH
// to a fresh temp file, and JWT_SECRET to a fixed test value, BEFORE
// importing '../auth' (module-load side effects: init() runs every
// migration, and auth.ts's resolveJwtSecret() reads JWT_SECRET at import
// time). `node --test` runs each test file in its own process, so this
// never collides with the real app DB or with other test files.
//
// No supertest: this repo has no HTTP-test dependency and the task brief
// only pre-approves `helmet` as a new dependency, so this file mounts
// auth.ts's router on a plain express() app, listens on an ephemeral port
// (`server.listen(0, ...)`), and drives it with Node's built-in global
// `fetch`. This is a real HTTP round trip end to end, just without a
// framework wrapper.
//
// Test ordering matters and is deliberate (node:test runs top-level tests
// in one file sequentially, in declaration order): POST /setup can only
// succeed once ("system already initialized" after that), and the
// persisted rate limiter's `login_attempts` table has ONE row per IP
// shared across all three endpoints (matching auth.ts's design, see
// database.ts's login_attempts comment) -- so tests that exhaust the
// limiter explicitly clear the table first/after, to avoid bleeding into
// unrelated tests that also hit these endpoints from the same loopback IP.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';

const tmpDbPath = path.join(os.tmpdir(), `auth-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-fixed-secret-for-auth-test-ts';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see
// services/pipeSources.test.ts's header: a plain `import db from
// './database'` compiles to a require() at this exact source position,
// which is what we need (DB_PATH must already be set, which it is above).
import authRouter, { authenticateToken } from './auth';
import db from './database';

const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
// A minimal authenticated route to exercise authenticateToken/token_version
// independently of any specific business route.
app.get('/api/protected', authenticateToken, (_req, res) => res.json({ ok: true }));

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

function clearRateLimitTable() {
  db.prepare('DELETE FROM login_attempts').run();
}

async function postJson(urlPath: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch (_) {
    // no body
  }
  return { status: res.status, json };
}

async function getJson(urlPath: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, { headers });
  let json: any = null;
  try {
    json = await res.json();
  } catch (_) {
    // no body
  }
  return { status: res.status, json };
}

const ADMIN_USERNAME = 'admin';
const PASSWORD_12_CHARS = 'SuperSecret1'; // exactly 12 chars
const PASSWORD_11_CHARS = 'SuperSecret'; // exactly 11 chars
assert.equal(PASSWORD_12_CHARS.length, 12);
assert.equal(PASSWORD_11_CHARS.length, 11);

let adminId: number;
let adminPassword = PASSWORD_12_CHARS;

// ─── 1. Password length policy ─────────────────────────────────────────────

test('POST /setup rejects an 11-character password with a 400 and clear message', async () => {
  const { status, json } = await postJson('/api/auth/setup', {
    username: ADMIN_USERNAME,
    password: PASSWORD_11_CHARS,
  });
  assert.equal(status, 400);
  assert.equal(json.error, 'Password must be at least 12 characters');
});

test('POST /setup did not create a user from the rejected 11-char attempt', async () => {
  const row = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };
  assert.equal(row.count, 0);
});

test('POST /setup accepts a 12-character password and creates the admin user', async () => {
  const { status, json } = await postJson('/api/auth/setup', {
    username: ADMIN_USERNAME,
    password: PASSWORD_12_CHARS,
  });
  assert.equal(status, 201);
  assert.ok(json.token);
  assert.equal(json.user.username, ADMIN_USERNAME);
  adminId = json.user.id;

  const decoded = jwt.verify(json.token, JWT_SECRET) as any;
  assert.equal(decoded.tokenVersion, 0, 'a freshly created user starts at tokenVersion 0');
});

test('POST /setup now rejects further attempts regardless of password length (system already initialized)', async () => {
  const { status, json } = await postJson('/api/auth/setup', {
    username: 'someoneElse',
    password: PASSWORD_12_CHARS,
  });
  assert.equal(status, 400);
  assert.equal(json.error, 'System already initialized');
});

// ─── login + token_version claim sanity ────────────────────────────────────

test('POST /login rejects an incorrect password', async () => {
  const { status } = await postJson('/api/auth/login', {
    username: ADMIN_USERNAME,
    password: 'totally-wrong-password',
  });
  assert.equal(status, 401);
});

test('POST /login succeeds with the correct password and issues a token with tokenVersion 0', async () => {
  const { status, json } = await postJson('/api/auth/login', {
    username: ADMIN_USERNAME,
    password: adminPassword,
  });
  assert.equal(status, 200);
  assert.ok(json.token);
  const decoded = jwt.verify(json.token, JWT_SECRET) as any;
  assert.equal(decoded.tokenVersion, 0);
});

test('GET /api/protected accepts a freshly issued, current-version token', async () => {
  const { json: loginJson } = await postJson('/api/auth/login', {
    username: ADMIN_USERNAME,
    password: adminPassword,
  });
  const { status } = await getJson('/api/protected', loginJson.token);
  assert.equal(status, 200);
});

// ─── 2. Persisted rate limiter ─────────────────────────────────────────────

test('persisted rate limiter: failed login attempts are recorded in the login_attempts SQLite table (survives a simulated restart)', async () => {
  clearRateLimitTable();

  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential, order matters for the counter
    await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: 'wrong-again' });
  }

  // Open a completely independent better-sqlite3 handle against the SAME
  // db file -- simulating a fresh process/module reload after a server
  // restart. If the limiter still used an in-memory Map, this second,
  // unrelated connection could never see these counts; because it's a
  // real persisted SQLite table, it does.
  const freshHandle = new Database(tmpDbPath, { readonly: true });
  const rows = freshHandle.prepare('SELECT ip, count FROM login_attempts').all() as any[];
  freshHandle.close();

  assert.equal(rows.length, 1, 'exactly one IP recorded');
  assert.equal(rows[0].count, 3);
});

test('persisted rate limiter: POST /auth/login returns 429 after LOGIN_MAX_ATTEMPTS (10) attempts in the window', async () => {
  clearRateLimitTable();
  let lastStatus = 0;
  for (let i = 0; i < 11; i++) {
    // eslint-disable-next-line no-await-in-loop
    const { status } = await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: 'wrong' });
    lastStatus = status;
  }
  assert.equal(lastStatus, 429);
});

test('persisted rate limiter: also applies to POST /auth/setup, not just /login', async () => {
  clearRateLimitTable();
  let lastStatus = 0;
  for (let i = 0; i < 11; i++) {
    // eslint-disable-next-line no-await-in-loop
    const { status } = await postJson('/api/auth/setup', { username: 'x', password: PASSWORD_12_CHARS });
    lastStatus = status;
  }
  assert.equal(lastStatus, 429, 'the 11th /setup attempt is rate-limited even though every attempt is otherwise a 400 (already initialized)');
});

test('persisted rate limiter: also applies to POST /auth/change-password, not just /login', async () => {
  clearRateLimitTable();
  const { json: loginJson } = await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: adminPassword });
  const token = loginJson.token;

  let lastStatus = 0;
  for (let i = 0; i < 11; i++) {
    // Deliberately wrong currentPassword every time so no attempt actually
    // succeeds and changes the password out from under the token being reused.
    // eslint-disable-next-line no-await-in-loop
    const { status } = await postJson('/api/auth/change-password', {
      currentPassword: 'definitely-wrong',
      newPassword: 'AnotherPass123',
    }, token);
    lastStatus = status;
  }
  assert.equal(lastStatus, 429);
  clearRateLimitTable();
});

// ─── 1b. Password length on change-password ────────────────────────────────

test('POST /change-password rejects an 11-character newPassword before touching the stored password', async () => {
  const { json: loginJson } = await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: adminPassword });
  const token = loginJson.token;

  const { status, json } = await postJson('/api/auth/change-password', {
    currentPassword: adminPassword,
    newPassword: PASSWORD_11_CHARS,
  }, token);
  assert.equal(status, 400);
  assert.equal(json.error, 'Password must be at least 12 characters');

  // Confirm the rejection happened before any update: the OLD token must
  // still be valid (token_version untouched) and the OLD password must
  // still work.
  const { status: stillWorks } = await getJson('/api/protected', token);
  assert.equal(stillWorks, 200);
});

// ─── 5. token_version invalidation end-to-end ──────────────────────────────

test('token_version: change-password invalidates the OLD token but the response includes a fresh, working NEW token', async () => {
  clearRateLimitTable();
  const { json: loginJson } = await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: adminPassword });
  const oldToken = loginJson.token;

  const newPassword = 'BrandNewPassword1';
  const { status, json: changeJson } = await postJson('/api/auth/change-password', {
    currentPassword: adminPassword,
    newPassword,
  }, oldToken);

  assert.equal(status, 200);
  assert.ok(changeJson.token, 'change-password response must include a fresh token so the caller is not locked out by its own password change');
  const newToken = changeJson.token;

  const decoded = jwt.verify(newToken, JWT_SECRET) as any;
  assert.equal(decoded.tokenVersion, 1);

  const { status: oldStatus } = await getJson('/api/protected', oldToken);
  assert.equal(oldStatus, 403, 'the pre-change token must now be rejected');

  const { status: newStatus } = await getJson('/api/protected', newToken);
  assert.equal(newStatus, 200, 'the freshly issued token must be accepted');

  adminPassword = newPassword;
});

// ─── 6. logout ──────────────────────────────────────────────────────────────

test('POST /auth/logout invalidates the token used to call it', async () => {
  clearRateLimitTable();
  const { json: loginJson } = await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: adminPassword });
  const token = loginJson.token;

  const { status: preStatus } = await getJson('/api/protected', token);
  assert.equal(preStatus, 200);

  const { status: logoutStatus, json: logoutJson } = await postJson('/api/auth/logout', {}, token);
  assert.equal(logoutStatus, 200);
  assert.ok(logoutJson.message);

  const { status: postStatus } = await getJson('/api/protected', token);
  assert.equal(postStatus, 403, 'the token used to log out must be rejected afterward');
});

test('a fresh login after logout still works (logout only invalidates prior tokens, not future ones)', async () => {
  const { json: loginJson } = await postJson('/api/auth/login', { username: ADMIN_USERNAME, password: adminPassword });
  const { status } = await getJson('/api/protected', loginJson.token);
  assert.equal(status, 200);
});

// ─── backward compatibility: missing tokenVersion claim treated as 0 ───────

test('authenticateToken treats a missing tokenVersion claim as version 0 (backward compat for pre-Task-15 tokens)', async () => {
  db.prepare('UPDATE users SET token_version = 0 WHERE id = ?').run(adminId);

  // Simulate a token issued before this deploy: same secret, but no
  // tokenVersion claim at all.
  const legacyToken = jwt.sign({ id: adminId, username: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });

  const { status } = await getJson('/api/protected', legacyToken);
  assert.equal(status, 200, 'a legacy token with no claim must be accepted when the DB is still at version 0');
});

test('a missing tokenVersion claim is NOT a universal bypass -- it is still compared against the current DB value', async () => {
  db.prepare('UPDATE users SET token_version = 5 WHERE id = ?').run(adminId);

  const legacyToken = jwt.sign({ id: adminId, username: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });

  const { status } = await getJson('/api/protected', legacyToken);
  assert.equal(status, 403, 'DB version has since moved on (5), so the version-less token must be rejected, not silently accepted');
});
