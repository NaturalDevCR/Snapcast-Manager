// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's `badMigrations`
// arrays bind name-bound function values (the `up`/`isApplied` closures),
// which is exactly the fingerprint that trips it. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/database/migrations.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `database/migrations.ts` file,
// which has no such pragma and is fully type-checked.
//
// These tests operate on plain, disposable `:memory:` better-sqlite3
// instances constructed directly with `new Database(':memory:')` -- NOT the
// real app singleton exported by `../database` -- so there is no need for
// the DB_PATH-env-var-before-import dance database.test.ts uses. This is
// what lets this file freely construct multiple independent DBs per test
// (a "pre-existing old-schema" one, a "fresh" one, etc.) without any
// process-wide state to isolate between them.
//
// `seedOldSchemaDb()` below is a byte-for-byte copy of the CREATE TABLE +
// ALTER TABLE statements the OLD database.ts code (pre-Task-24) actually
// ran -- i.e. exactly what a real user's on-disk database looks like today,
// right before this upgrade. It deliberately does NOT create a
// `schema_migrations` table (the old code never had one), which is the
// defining fingerprint runMigrations() must detect and backfill correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { migrations, runMigrations, type Migration } from './migrations';

function seedOldSchemaDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      filename TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS snapclient_instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 1704,
      soundcard TEXT NOT NULL,
      host_id TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS script_paths (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS radio_pipe_streams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      reconnect INTEGER DEFAULT 1,
      reconnect_streamed INTEGER DEFAULT 1,
      reconnect_at_eof INTEGER DEFAULT 1,
      reconnect_delay_max INTEGER DEFAULT 30,
      idle_threshold INTEGER DEFAULT 15000,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipe_source_config_backup (
      pipe_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    );
  `);
  // Simulate the old ad-hoc try/catch ALTER TABLE migrations having already
  // run successfully on this install at some point in the past.
  db.exec("ALTER TABLE radio_pipe_streams ADD COLUMN type TEXT NOT NULL DEFAULT 'radio'");
  db.exec('ALTER TABLE snapclient_instances ADD COLUMN instance_num INTEGER DEFAULT 1');
  db.exec('ALTER TABLE script_paths ADD COLUMN managed INTEGER NOT NULL DEFAULT 1');
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  return db;
}

const OLD_SCHEMA_TABLES = [
  'users',
  'settings',
  'snapshots',
  'snapclient_instances',
  'script_paths',
  'radio_pipe_streams',
  'pipe_source_config_backup',
  'login_attempts',
];

// ---- THE most important test in this task: backfilling schema_migrations
// against a real pre-existing (old-code-created) database, with real data,
// must not error, must not lose data, and must not re-run any ALTER TABLE
// that would blow up with "duplicate column name". ----

test('backfill: running the new migration system against a pre-existing OLD-schema DB marks everything applied, without error or data loss', () => {
  const db = seedOldSchemaDb();

  db.prepare('INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, ?)').run(
    'admin', 'hashed-pw', 'admin', 0,
  );
  db.prepare('INSERT INTO radio_pipe_streams (id, name, url, type) VALUES (?, ?, ?, ?)').run(
    'r1', 'Radio 1', 'http://example.com/stream.mp3', 'radio',
  );
  db.prepare('INSERT INTO snapclient_instances (id, name, soundcard, instance_num) VALUES (?, ?, ?, ?)').run(
    'c1', 'Client 1', 'hw:0', 1,
  );
  db.prepare('INSERT INTO script_paths (id, label, path, managed) VALUES (?, ?, ?, ?)').run(
    's1', 'Script 1', '/var/lib/snapcast-manager/scripts/x.sh', 1,
  );

  // Sanity: this DB has no schema_migrations table -- the defining
  // fingerprint of "a pre-existing install that predates this task".
  const before = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  assert.equal(before, undefined);

  assert.doesNotThrow(() => runMigrations(db, migrations));

  // Every migration -- including the ones that were already applied by the
  // OLD code -- is now recorded.
  const appliedVersions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[])
    .map(r => r.version);
  assert.deepEqual(appliedVersions, migrations.map(m => m.version));

  // No data loss: every previously-seeded row survives with its data intact.
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get('admin') as any;
  assert.equal(user.token_version, 0);
  assert.equal(user.role, 'admin');

  const radio = db.prepare('SELECT * FROM radio_pipe_streams WHERE id = ?').get('r1') as any;
  assert.equal(radio.type, 'radio');
  assert.equal(radio.url, 'http://example.com/stream.mp3');

  const client = db.prepare('SELECT * FROM snapclient_instances WHERE id = ?').get('c1') as any;
  assert.equal(client.instance_num, 1);

  const script = db.prepare('SELECT * FROM script_paths WHERE id = ?').get('s1') as any;
  assert.equal(script.managed, 1);

  // The genuinely NEW table introduced by this same task (no old-code
  // equivalent) gets created for real, since there's nothing to backfill.
  const jobsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
  assert.notEqual(jobsTable, undefined, 'jobs table must be created for a DB that never had it');

  db.close();
});

test('backfill: does not attempt to re-run an already-applied ALTER TABLE (which would throw "duplicate column name")', () => {
  const db = seedOldSchemaDb();
  // If runMigrations() naively re-ran every migration's up() unconditionally
  // instead of detecting the backfill case via isApplied(), this would throw
  // "duplicate column name" here.
  assert.doesNotThrow(() => runMigrations(db, migrations));
  db.close();
});

test('runMigrations is idempotent: a second run on an already-migrated DB is a no-op (no errors, same recorded versions)', () => {
  const db = new Database(':memory:');
  runMigrations(db, migrations);
  const first = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(r => r.version);

  assert.doesNotThrow(() => runMigrations(db, migrations));
  const second = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(r => r.version);

  assert.deepEqual(second, first);
  db.close();
});

test('fresh DB via the new migration system is structurally identical to one produced by the OLD code (PRAGMA table_info per table)', () => {
  const oldDb = seedOldSchemaDb();
  const newDb = new Database(':memory:');
  runMigrations(newDb, migrations);

  for (const table of OLD_SCHEMA_TABLES) {
    const oldInfo = oldDb.prepare(`PRAGMA table_info(${table})`).all();
    const newInfo = newDb.prepare(`PRAGMA table_info(${table})`).all();
    assert.deepEqual(newInfo, oldInfo, `PRAGMA table_info mismatch for table "${table}"`);
  }

  oldDb.close();
  newDb.close();
});

test('a genuine migration failure aborts loudly (throws) and does not record that version as applied', () => {
  const db = new Database(':memory:');
  const badMigrations: Migration[] = [
    {
      version: 1,
      name: 'ok baseline',
      isApplied: () => false,
      up: d => {
        d.exec('CREATE TABLE ok (id INTEGER)');
      },
    },
    {
      version: 2,
      name: 'broken migration',
      isApplied: () => false,
      up: () => {
        throw new Error('simulated genuine migration failure');
      },
    },
  ];

  assert.throws(() => runMigrations(db, badMigrations), /simulated genuine migration failure/);

  const applied = (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version);
  assert.deepEqual(applied, [1], 'only the successful migration should be recorded');
  db.close();
});

test('a migration that fails partway rolls back its own DDL (transaction-wrapped, no half-applied state)', () => {
  const db = new Database(':memory:');
  const badMigrations: Migration[] = [
    {
      version: 1,
      name: 'partially fails',
      isApplied: () => false,
      up: d => {
        d.exec('CREATE TABLE partial (id INTEGER)');
        throw new Error('fails after partial DDL');
      },
    },
  ];

  assert.throws(() => runMigrations(db, badMigrations), /fails after partial DDL/);

  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='partial'").get();
  assert.equal(table, undefined, 'the transaction must have rolled back the partial CREATE TABLE');
  db.close();
});

test('schema_migrations table has the version/applied_at shape the brief specifies', () => {
  const db = new Database(':memory:');
  runMigrations(db, migrations);
  const cols = (db.prepare('PRAGMA table_info(schema_migrations)').all() as { name: string; pk: number }[]);
  const names = cols.map(c => c.name).sort();
  assert.deepEqual(names, ['applied_at', 'version']);
  const versionCol = cols.find(c => c.name === 'version')!;
  assert.equal(versionCol.pk, 1, 'version must be the PRIMARY KEY');
  db.close();
});
