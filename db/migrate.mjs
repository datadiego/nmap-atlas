import { Database } from 'bun:sqlite';
import { readText, ensureDir } from '../core/fs.mjs';
import { dirname, join, resolve } from '../core/path.mjs';

/**
 * Inicializa SQLite aplicando el esquema completo. `schema.sql` es idempotente,
 * así que se ejecuta en cada arranque sin tablas de versiones ni migraciones.
 */
export function openDatabase(file) {
  if (file && file !== ':memory:') ensureDir(dirname(resolve(file)));
  const db = new Database(file);
  // bun:sqlite expone query()/prepare(), pero no los atajos get/all que usan
  // los repositorios. Se añaden aquí para no duplicarlos en cada consulta.
  db.get = (sql, ...params) => db.query(sql).get(...params);
  db.all = (sql, ...params) => db.query(sql).all(...params);
  return db;
}

export async function initializeDatabase(config) {
  const db = openDatabase(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');

  const dbDir = config.dbDir ?? resolve('db');
  const schema = await readText(join(dbDir, 'schema.sql'));
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
