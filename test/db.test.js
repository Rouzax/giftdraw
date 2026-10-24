import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, applyMigrations } from '../src/db/open.js';
import { migrations } from '../src/db/migrations.js';

function userVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
}

test('a fresh database ends at the latest user_version', () => {
  const db = openDb(':memory:');
  assert.equal(userVersion(db), migrations.length);
  assert.deepEqual(tableNames(db), ['events', 'groups', 'outbox', 'participants']);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA secure_delete').get().secure_delete, 1);
  db.close();
});

test('a file database uses WAL and reopening applies nothing twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'giftdraw-db-'));
  try {
    const path = join(dir, 'test.db');
    openDb(path).close();
    const db = openDb(path);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(userVersion(db), migrations.length);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a migration whose second statement fails leaves version and schema unchanged', () => {
  const db = new DatabaseSync(':memory:');
  const good = 'CREATE TABLE a (x INTEGER)';
  const bad = 'CREATE TABLE b (x INTEGER); INSERT INTO missing_table VALUES (1)';

  assert.throws(() => applyMigrations(db, [bad]));
  assert.equal(userVersion(db), 0);
  assert.deepEqual(tableNames(db), []);

  applyMigrations(db, [good]);
  assert.throws(() => applyMigrations(db, [good, bad]));
  assert.equal(userVersion(db), 1);
  assert.deepEqual(tableNames(db), ['a']);
  db.close();
});

test('a database newer than the code is refused', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = 5');
  assert.throws(() => applyMigrations(db, ['CREATE TABLE a (x INTEGER)']), /newer/);
  db.close();
});

test('migration 2 adds events.form_config to a version 1 database and keeps its rows', () => {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db, migrations.slice(0, 1));
  db.prepare("INSERT INTO events (name, language, wish_options, created_at) VALUES ('Gifts', 'nl', '[]', '2026-01-01')").run();
  applyMigrations(db, migrations);
  assert.equal(userVersion(db), migrations.length);
  const row = db.prepare('SELECT name, wish_options, form_config FROM events').get();
  assert.deepEqual({ ...row }, { name: 'Gifts', wish_options: '[]', form_config: null });
  db.close();
});

test('a fresh database has events.form_config', () => {
  const db = openDb(':memory:');
  const columns = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  assert.ok(columns.includes('form_config'));
  db.close();
});

test('a connection waits for a lock instead of failing at once', () => {
  const db = openDb(':memory:');
  assert.ok(db.prepare('PRAGMA busy_timeout').get().timeout >= 1000);
  db.close();
});
