import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './database/migrations';

const isDev = process.env.NODE_ENV !== 'production';
const dbDir = isDev
  ? path.join(__dirname, '../data')
  : path.join(__dirname, '../../data');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dbDir, 'snapmanager.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

// Task 24: versioned, tracked migrations (see ./database/migrations.ts)
// replace the old "CREATE TABLE IF NOT EXISTS + try/catch-swallowed ALTER
// TABLE" pattern. Every migration is recorded in `schema_migrations` on
// success; a genuine failure (a broken statement, a disk error, a real
// constraint violation) now propagates out of runMigrations() and crashes
// startup loudly instead of being silently swallowed by a bare
// `catch (_) {}` -- see task-24-report.md for the full design rationale
// and the pre-existing-install backfill test evidence.
const init = () => {
  runMigrations(db);

  // Check for users count (for setup wizard)
  const stmt = db.prepare('SELECT count(*) as count FROM users');
  const result = stmt.get() as { count: number };
  if (result.count === 0) {
    console.log('No users found. System ready for Setup Wizard.');
  }
};

init();

export default db;
