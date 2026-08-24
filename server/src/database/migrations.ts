import Database from 'better-sqlite3';
import { isPathInsideManagedDir } from '../services/tools';

/**
 * A single, ordered, numbered schema migration.
 *
 * Chosen shape: an in-code ordered ARRAY of `{ version, name, isApplied, up }`
 * objects (this file), rather than one file per migration loaded off disk
 * from `server/src/database/migrations/*.ts` at runtime. For ~6 migrations
 * this is simpler (one file to read top-to-bottom instead of N), and it
 * compiles straight into `server/dist` via the normal `tsc -b` build --
 * no separate file-glob/require-all-files-in-a-directory loader needed at
 * runtime, no risk of the loader silently missing a file that didn't get
 * copied into `dist/` by some future packaging change.
 *
 * `isApplied` is the mechanism that makes upgrading a PRE-EXISTING
 * database (one that already has these tables/columns from the OLD
 * `CREATE TABLE IF NOT EXISTS` + `try/catch ALTER TABLE` code, but no
 * `schema_migrations` table) safe: runMigrations() below checks it BEFORE
 * calling `up()`, and only calls `up()` when it returns false. On an
 * old-style DB, every migration's `isApplied()` already returns true (the
 * table/column is already there), so `up()` never runs again -- the
 * migration is simply recorded as applied. On a genuinely fresh DB,
 * `isApplied()` returns false for everything, so `up()` runs for real, in
 * order, exactly as it would have on a brand new install. This is the same
 * mechanism either way; there is no separate "is this an upgrade" branch
 * anywhere in this file or in runMigrations().
 */
export interface Migration {
  version: number;
  name: string;
  /**
   * Returns true if this migration's effect is ALREADY present in `db`
   * (i.e. the table/column it would create already exists). Must be a pure
   * read (PRAGMA / sqlite_master queries only) -- never mutate `db` here.
   */
  isApplied: (db: Database.Database) => boolean;
  /** Applies the migration. Only ever called when isApplied() is false, and always inside a transaction. */
  up: (db: Database.Database) => void;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  // PRAGMA doesn't accept bound parameters for the table name; `table` is
  // always one of this file's own hardcoded literals below, never
  // user/request input, so string interpolation here is safe.
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === column);
}

const BASELINE_TABLES = [
  'users',
  'settings',
  'snapshots',
  'snapclient_instances',
  'script_paths',
  'radio_pipe_streams',
  'pipe_source_config_backup',
  'login_attempts',
];

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'baseline schema',
    isApplied: db => BASELINE_TABLES.every(t => tableExists(db, t)),
    // Byte-for-byte the same CREATE TABLE statements the old database.ts
    // ran unconditionally on every boot (each already IF NOT EXISTS, so
    // even calling this a second time would be harmless -- isApplied()
    // above just avoids doing so needlessly).
    up: db => {
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
    },
  },
  {
    version: 2,
    name: "radio_pipe_streams.type (radio | mpd)",
    isApplied: db => columnExists(db, 'radio_pipe_streams', 'type'),
    up: db => {
      db.exec("ALTER TABLE radio_pipe_streams ADD COLUMN type TEXT NOT NULL DEFAULT 'radio'");
    },
  },
  {
    version: 3,
    name: 'snapclient_instances.instance_num (+ sequential backfill)',
    isApplied: db => columnExists(db, 'snapclient_instances', 'instance_num'),
    up: db => {
      db.exec('ALTER TABLE snapclient_instances ADD COLUMN instance_num INTEGER DEFAULT 1');
      // Backfill existing rows with sequential numbers ordered by creation time.
      const rows = db.prepare('SELECT id FROM snapclient_instances ORDER BY created_at ASC').all() as { id: string }[];
      const update = db.prepare('UPDATE snapclient_instances SET instance_num = ? WHERE id = ?');
      rows.forEach((row, i) => {
        update.run(i + 1, row.id);
      });
    },
  },
  {
    version: 4,
    name: 'script_paths.managed (+ reclassify existing rows)',
    isApplied: db => columnExists(db, 'script_paths', 'managed'),
    // Task 9: closes the arbitrary-file-write-as-root vulnerability
    // (design-spec finding #3) by restricting POST /api/tools/scripts to
    // MANAGED_SCRIPTS_DIR going forward. Existing rows registered before
    // this fix may point anywhere on the filesystem; they are NOT deleted
    // (that could silently break something an operator relies on seeing)
    // but are classified here so routes/tools.ts's write endpoint can
    // reject writes to anything outside MANAGED_SCRIPTS_DIR while still
    // allowing reads. `ADD COLUMN ... DEFAULT 1` backfills every
    // pre-existing row with `managed = 1` at add-time; the loop below then
    // reclassifies each one for real using the same boundary/symlink check
    // the registration route itself uses (`isPathInsideManagedDir`).
    up: db => {
      db.exec('ALTER TABLE script_paths ADD COLUMN managed INTEGER NOT NULL DEFAULT 1');
      const rows = db.prepare('SELECT id, path FROM script_paths').all() as { id: string; path: string }[];
      const reclassify = db.prepare('UPDATE script_paths SET managed = ? WHERE id = ?');
      for (const row of rows) {
        reclassify.run(isPathInsideManagedDir(row.path) ? 1 : 0, row.id);
      }
    },
  },
  {
    version: 5,
    name: 'users.token_version',
    isApplied: db => columnExists(db, 'users', 'token_version'),
    // Task 15: incremented by POST /auth/change-password and
    // POST /auth/logout to invalidate every previously-issued JWT for that
    // user (see auth.ts's authenticateToken). `DEFAULT 0` backfills every
    // pre-existing row to 0, and a JWT issued before this migration ran has
    // no `tokenVersion` claim at all -- authenticateToken treats a missing
    // claim as 0 too, so already-issued tokens keep working after this
    // migration runs instead of every session breaking at once.
    up: db => {
      db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 6,
    name: 'jobs table (Task 24: persistent job state)',
    isApplied: db => tableExists(db, 'jobs'),
    // No old-code equivalent -- this table is entirely new, so there is
    // nothing to backfill/reclassify here, unlike migrations 2-5 above.
    // `log` is stored as a JSON-encoded TEXT array (bounded to 500 lines by
    // jobService's existing MAX_LOG_LINES) rather than a separate table --
    // see services/jobs.ts and task-24-report.md for why per-line-append
    // cost at that bound is fine.
    up: db => {
      db.exec(`
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          status TEXT NOT NULL,
          log TEXT NOT NULL DEFAULT '[]',
          output TEXT,
          error TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER
        );
      `);
    },
  },
];

/**
 * Runs every migration in `migrationList` (defaults to the real
 * `migrations` array above) against `db`, in ascending `version` order,
 * skipping any version already recorded in `schema_migrations`.
 *
 * For a version not yet recorded: checks `isApplied(db)` first. If true
 * (the pre-existing-DB backfill case -- see the `Migration` doc comment
 * above), `up()` is skipped entirely and the version is just recorded. If
 * false, `up()` runs for real. Either way, the `up()` call (when it
 * happens) and the `schema_migrations` INSERT happen inside the SAME
 * better-sqlite3 transaction, so a genuine failure (a throwing `up()`, a
 * disk error, a constraint violation) rolls back any partial DDL/DML that
 * migration attempted AND leaves that version unrecorded -- the error then
 * propagates straight out of this function (no try/catch swallowing it),
 * which is what makes a real failure abort startup loudly instead of
 * silently limping on with an incomplete schema.
 */
export function runMigrations(db: Database.Database, migrationList: Migration[] = migrations): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version),
  );

  const recordApplied = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

  for (const migration of migrationList) {
    if (appliedVersions.has(migration.version)) continue;

    const alreadyPresentOnDisk = migration.isApplied(db);

    const runOne = db.transaction(() => {
      if (!alreadyPresentOnDisk) {
        migration.up(db);
      }
      recordApplied.run(migration.version);
    });

    runOne();
  }
}
