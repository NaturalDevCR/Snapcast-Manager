import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import { isPathInsideManagedDir } from './services/tools';

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

// Init tables
const init = () => {
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

    -- Task 14: one-slot-per-pipe backup of a pipe source's raw config
    -- content (systemd unit text for radio, mpd audio_output block for
    -- mpd), written by services/pipeSources.ts's setConfigContent() just
    -- before it installs new content, and restored by rollbackConfig().
    -- PRIMARY KEY pipe_id (not an autoincrement id) is what keeps this to
    -- exactly one previous version per pipe -- a second backup for the same
    -- pipe_id overwrites the first via the upsert in setConfigContent(),
    -- it never accumulates a history.
    CREATE TABLE IF NOT EXISTS pipe_source_config_backup (
      pipe_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Task 15: persisted login-rate-limiter state, keyed by client IP. This
    -- replaces auth.ts's old in-memory Map<ip, {count, windowStart}>, which
    -- reset to empty on every server restart -- a free rate-limit reset for
    -- an attacker, and this app's own install/update features cause the
    -- server to restart itself, so that reset was reachable in practice.
    -- One shared row per IP is deliberately reused across all three
    -- rate-limited endpoints (/auth/login, /auth/setup,
    -- /auth/change-password) -- see auth.ts's loginRateLimiter -- rather
    -- than keying by (ip, route), matching the brief's schema.
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    );
  `);

  // Migration: add type column to pipe sources (radio | mpd)
  try {
    db.exec("ALTER TABLE radio_pipe_streams ADD COLUMN type TEXT NOT NULL DEFAULT 'radio'");
  } catch (_) {
    // Column already exists — no-op
  }

  // Migration: add instance_num column for unique per-machine snapclient identification
  try {
    db.exec('ALTER TABLE snapclient_instances ADD COLUMN instance_num INTEGER DEFAULT 1');
    // Backfill existing rows with sequential numbers ordered by creation time
    const rows = db.prepare('SELECT id FROM snapclient_instances ORDER BY created_at ASC').all() as any[];
    rows.forEach((row, i) => {
      db.prepare('UPDATE snapclient_instances SET instance_num = ? WHERE id = ?').run(i + 1, row.id);
    });
  } catch (_) {
    // Column already exists — no-op
  }

  // Migration (Task 9): add `managed` column to script_paths -- closes the
  // arbitrary-file-write-as-root vulnerability (design-spec finding #3) by
  // restricting POST /api/tools/scripts to MANAGED_SCRIPTS_DIR going
  // forward. Existing rows registered before this fix may point anywhere
  // on the filesystem; they are NOT deleted (that could silently break
  // something an operator relies on seeing) but are classified here so
  // routes/tools.ts's write endpoint can reject writes to anything outside
  // MANAGED_SCRIPTS_DIR while still allowing reads. `ADD COLUMN ... DEFAULT
  // 1` backfills every pre-existing row with `managed = 1` at add-time;
  // the loop below then reclassifies each one for real using the same
  // boundary/symlink check the registration route itself uses
  // (`isPathInsideManagedDir`, from services/tools.ts), so a legacy row
  // pointing e.g. at /etc/sudoers.d/pwn ends up `managed = 0`. New rows
  // inserted via the fixed POST /scripts are always managed = 1 -- enforced
  // by that route's own validation, which rejects the insert entirely
  // otherwise, not by anything here.
  try {
    db.exec('ALTER TABLE script_paths ADD COLUMN managed INTEGER NOT NULL DEFAULT 1');
    const rows = db.prepare('SELECT id, path FROM script_paths').all() as { id: string; path: string }[];
    const reclassify = db.prepare('UPDATE script_paths SET managed = ? WHERE id = ?');
    for (const row of rows) {
      reclassify.run(isPathInsideManagedDir(row.path) ? 1 : 0, row.id);
    }
  } catch (_) {
    // Column already exists — no-op
  }

  // Migration (Task 15): add `token_version` to users -- incremented by
  // POST /auth/change-password and POST /auth/logout to invalidate every
  // previously-issued JWT for that user (see auth.ts's authenticateToken,
  // which rejects a token whose `tokenVersion` claim doesn't match this
  // column's current value). `DEFAULT 0` means: (a) every pre-existing row
  // backfills to 0 here, and (b) a JWT issued before this migration ran has
  // no `tokenVersion` claim at all -- authenticateToken treats a missing
  // claim as 0 too, so those already-issued tokens keep working after this
  // deploy instead of every session breaking at once.
  try {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  } catch (_) {
    // Column already exists — no-op
  }

  // Check for users count (for setup wizard)
  const stmt = db.prepare('SELECT count(*) as count FROM users');
  const result = stmt.get() as { count: number };
  if (result.count === 0) {
    console.log('No users found. System ready for Setup Wizard.');
  }
};

init();

export default db;
