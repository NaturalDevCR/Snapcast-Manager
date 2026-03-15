import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

const dbPath = process.env.DB_PATH || path.join(__dirname, '../snapmanager.db');
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
  `);

  // Check for users count (for setup wizard)
  const stmt = db.prepare('SELECT count(*) as count FROM users');
  const result = stmt.get() as { count: number };
  if (result.count === 0) {
    console.log('No users found. System ready for Setup Wizard.');
  }
};

init();

export default db;
