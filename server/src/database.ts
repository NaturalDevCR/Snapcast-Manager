import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';
import fs from 'fs';

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
  `);

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

  // Check for users count (for setup wizard)
  const stmt = db.prepare('SELECT count(*) as count FROM users');
  const result = stmt.get() as { count: number };
  if (result.count === 0) {
    console.log('No users found. System ready for Setup Wizard.');
  }
};

init();

export default db;
