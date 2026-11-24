import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from './driver.mjs';

/**
 * Inicializa SQLite aplicando el esquema completo. `schema.sql` es idempotente,
 * así que se ejecuta en cada arranque sin tablas de versiones ni migraciones.
 */
export async function initializeDatabase(config) {
  const db = await openDatabase(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');

  const dbDir = config.dbDir ?? path.resolve(process.cwd(), 'db');
  const schema = await readFile(path.join(dbDir, 'schema.sql'), 'utf8');
  db.transaction(() => {
    db.exec(schema);
    db.run(
      `INSERT INTO app_settings (id, updated_at) VALUES (1, ?)
       ON CONFLICT(id) DO NOTHING`,
      Date.now(),
    );
  })();

  return db;
}
