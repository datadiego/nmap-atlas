import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Pequeña capa común sobre bun:sqlite y node:sqlite.
 * Todo el SQL de la app pasa por aquí; los repositorios no necesitan saber
 * qué runtime está sirviendo la API.
 * El runtime se elige solo al abrir la base de datos.
 */

class Statement {
  constructor(statement) {
    this.statement = statement;
  }

  static args(params) {
    return params.map((value) => (value === undefined ? null : value));
  }

  all(...params) {
    return this.statement.all(...Statement.args(params)) ?? [];
  }

  get(...params) {
    return this.statement.get(...Statement.args(params)) ?? null;
  }

  run(...params) {
    const result = this.statement.run(...Statement.args(params));
    return {
      changes: Number(result?.changes ?? 0),
      lastInsertRowid: result?.lastInsertRowid == null
        ? null
        : Number(result.lastInsertRowid),
    };
  }
}

class Database {
  constructor(raw) {
    this.raw = raw;
  }

  exec(sql) {
    this.raw.exec(sql);
    return this;
  }

  prepare(sql) {
    return new Statement(this.raw.prepare(sql));
  }

  get(sql, ...params) {
    return this.prepare(sql).get(...params);
  }

  all(sql, ...params) {
    return this.prepare(sql).all(...params);
  }

  run(sql, ...params) {
    return this.prepare(sql).run(...params);
  }

  transaction(fn) {
    return (...params) => {
      this.exec('BEGIN');
      try {
        const result = fn(...params);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.exec('ROLLBACK'); } catch { /* ya se ha deshecho */ }
        throw error;
      }
    };
  }

  close() {
    this.raw.close();
  }
}

export async function openDatabase(file) {
  if (file && file !== ':memory:') {
    await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  }

  if (globalThis.Bun?.sqlite) {
    const { Database: BunDatabase } = await import('bun:sqlite');
    return new Database(new BunDatabase(file));
  }

  const { DatabaseSync } = await import('node:sqlite');
  return new Database(new DatabaseSync(file));
}
