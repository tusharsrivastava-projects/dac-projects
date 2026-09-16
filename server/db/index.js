import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

/** Run fn inside a transaction; nested calls reuse the outer transaction. */
export const tx = (fn) => db.transaction(fn);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

export function logActivity({ actorId = null, actorName = null, action, entity = null, entityId = null, detail = null }) {
  db.prepare(
    `INSERT INTO activity_log (actor_id, actor_name, action, entity, entity_id, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(actorId, actorName, action, entity, entityId, detail);
}
