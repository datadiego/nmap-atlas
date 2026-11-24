import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from './driver.mjs';

const MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`;

function versionOfFile(name) {
  const match = /^(\d+)_.*\.sql$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** Los nombres con .xml son del antiguo archivo; los dejamos solo como identificadores. */
function normalizeScanNames(db) {
  return db.transaction(() => {
    let renamed = 0;
    for (let pass = 0; pass < 10; pass += 1) {
      const rows = db.all("SELECT id, name FROM scans WHERE lower(name) LIKE '%.xml' ORDER BY id");
      if (!rows.length) break;
      const taken = new Set(db.all('SELECT name FROM scans').map((row) => row.name));
      for (const row of rows) {
        const base = row.name.slice(0, -4) || 'scan';
        let candidate = base;
        let suffix = 1;
        while (taken.has(candidate)) candidate = `${base}-${suffix += 1}`;
        db.run(
          'UPDATE scans SET name = ?, updated_at = ? WHERE id = ?',
          candidate,
          Date.now(),
          row.id,
        );
        taken.delete(row.name);
        taken.add(candidate);
        renamed += 1;
      }
    }
    return renamed;
  })();
}

export async function initializeDatabase(config) {
  const db = await openDatabase(config.dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(MIGRATION_TABLE);

  const current = Number(db.get('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')?.version ?? 0);
  const dbDir = config.dbDir ?? path.resolve(process.cwd(), 'db');

  if (current < 1) {
    const schema = await readFile(path.join(dbDir, 'schema.sql'), 'utf8');
    db.transaction(() => {
      db.exec(schema);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)', Date.now());
    })();
  }

  const files = await readdir(path.join(dbDir, 'migrations')).catch(() => []);
  const migrations = files
    .map((name) => ({ name, version: versionOfFile(name) }))
    .filter((item) => item.version !== null && item.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of migrations) {
    const sql = await readFile(path.join(dbDir, 'migrations', migration.name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', migration.version, Date.now());
    })();
  }

  // Ajustes del esquema v1 añadidos mientras se desarrollaba la migración.
  // Se comprueba por nombre para que una BD ya creada siga siendo válida.
  const ensureColumns = (table, columns) => {
    const existing = new Set(db.all(`PRAGMA table_info(${table})`).map((row) => row.name));
    columns.forEach(([name, sql]) => {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
    });
  };
  ensureColumns('app_settings', [['legacy_imported', 'INTEGER NOT NULL DEFAULT 0']]);
  ensureColumns('scan_jobs', [
    ['bytes', 'INTEGER NOT NULL DEFAULT 0'],
    ['host_hints', 'INTEGER NOT NULL DEFAULT 0'],
    ['hosts', 'INTEGER NOT NULL DEFAULT 0'],
    ['event_count', 'INTEGER NOT NULL DEFAULT 0'],
  ]);

  db.run(
    `INSERT INTO app_settings (id, updated_at) VALUES (1, ?)
     ON CONFLICT(id) DO NOTHING`,
    Date.now(),
  );

  db.renamedScans = normalizeScanNames(db);
  return db;
}
