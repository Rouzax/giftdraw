import { DatabaseSync } from 'node:sqlite';
import { migrations as schemaMigrations } from './migrations.js';

// Applies every migration past the database's user_version. Each migration
// and its user_version bump commit together, so a failure anywhere in a
// migration leaves both the schema and the version as they were.
export function applyMigrations(db, migrations) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > migrations.length) {
    throw new Error(`Database schema version ${current} is newer than this code supports (${migrations.length})`);
  }
  for (let version = current + 1; version <= migrations.length; version += 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[version - 1]);
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  // An outside reader such as `sqlite3 .backup` holds a lock for a moment;
  // waiting for it beats failing the request with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000');
  // Overwrite deleted content so expired groups do not linger in free pages.
  db.exec('PRAGMA secure_delete = ON');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  applyMigrations(db, schemaMigrations);
  return db;
}
