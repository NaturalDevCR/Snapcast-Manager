// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- here it strips the `as
// any` cast on `db.prepare(...).get(...)`'s result, leaving `row` typed
// `unknown` and failing to compile. Correctness is independently confirmed
// with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/database.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `database.ts` file, which has no
// such pragma and is fully type-checked.
//
// Tests the Task 9 `managed` column migration on `script_paths`.
//
// DB isolation: same pattern as services/pipeSources.test.ts -- set
// DB_PATH to a fresh temp file BEFORE importing '../database' (module-load
// side effect runs `init()`, which applies every migration). `node --test`
// runs each test file in its own process, so this never collides with the
// real app DB or with other test files.
//
// To simulate a pre-Task-9 upgrade (an existing installation whose
// `script_paths` table predates the `managed` column), this file manually
// creates the table WITHOUT that column and seeds two rows -- one whose
// path resolves inside MANAGED_SCRIPTS_DIR, one whose path resolves
// outside it -- using a raw better-sqlite3 handle, BEFORE importing
// '../database'. Importing '../database' then runs its migration logic
// against this pre-seeded table, exactly as it would on a real upgrade.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

const tmpDbPath = path.join(os.tmpdir(), `database-migration-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;
process.env.NODE_ENV = 'test';

const insideId = randomUUID();
const outsideId = randomUUID();

const seedDb = new Database(tmpDbPath);
seedDb.exec(`
  CREATE TABLE script_paths (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
seedDb.prepare('INSERT INTO script_paths (id, label, path) VALUES (?, ?, ?)')
  .run(insideId, 'inside', '/var/lib/snapcast-manager/scripts/legit.sh');
seedDb.prepare('INSERT INTO script_paths (id, label, path) VALUES (?, ?, ?)')
  .run(outsideId, 'outside', '/etc/sudoers.d/pwn');
seedDb.close();

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see
// services/pipeSources.test.ts's header: a plain `import db from
// '../database'` compiles to a require() at this exact source position,
// which is what we need (DB_PATH must already be set, which it is above);
// this file just states that dependency explicitly rather than relying on
// import-statement placement semantics.
import db from './database';

test('managed column migration classifies a pre-existing in-managed-dir row as managed', () => {
  const row = db.prepare('SELECT managed FROM script_paths WHERE id = ?').get(insideId) as any;
  assert.equal(row.managed, 1);
});

test('managed column migration classifies a pre-existing out-of-managed-dir row as unmanaged', () => {
  const row = db.prepare('SELECT managed FROM script_paths WHERE id = ?').get(outsideId) as any;
  assert.equal(row.managed, 0);
});

test('re-adding the managed column raises (confirming why database.ts wraps the migration in try/catch to stay idempotent across boots)', () => {
  assert.throws(() => {
    db.exec('ALTER TABLE script_paths ADD COLUMN managed INTEGER NOT NULL DEFAULT 1');
  }, /duplicate column name/);
});
