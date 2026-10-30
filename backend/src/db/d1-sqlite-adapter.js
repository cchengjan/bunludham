/**
 * Cloudflare D1-compatible adapter backed by Node's built-in `node:sqlite` (`DatabaseSync`).
 * Enables running the exact Cloudflare Worker codebase locally and in automated tests
 * with zero external npm dependencies.
 */

import { DatabaseSync } from 'node:sqlite';

function normalizeParam(val) {
  if (val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

class D1PreparedStatementAdapter {
  constructor(sqliteDb, sql, boundValues = []) {
    this._db = sqliteDb;
    this._sql = sql;
    this._params = boundValues;
  }

  bind(...values) {
    return new D1PreparedStatementAdapter(
      this._db,
      this._sql,
      values.map(normalizeParam)
    );
  }

  async first(colName) {
    const stmt = this._db.prepare(this._sql);
    const row = stmt.get(...this._params);
    if (!row) return null;
    const plain = { ...row };
    if (colName) {
      return Object.prototype.hasOwnProperty.call(plain, colName) ? plain[colName] : null;
    }
    return plain;
  }

  async all() {
    const stmt = this._db.prepare(this._sql);
    const rows = stmt.all(...this._params).map((r) => ({ ...r }));
    return {
      success: true,
      results: rows,
      meta: { rows_read: rows.length }
    };
  }

  async run() {
    const stmt = this._db.prepare(this._sql);
    const res = stmt.run(...this._params);
    const changes = Number(res.changes || 0);
    const lastRowId = res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : null;
    return {
      success: true,
      changes,
      meta: {
        changes,
        last_row_id: lastRowId,
        changed_db: changes > 0
      }
    };
  }
}

export function createSqliteD1Adapter(filename = ':memory:') {
  const sqliteDb = new DatabaseSync(filename);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  if (filename !== ':memory:') {
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
  }

  return {
    _rawSqlite: sqliteDb,

    prepare(sql) {
      return new D1PreparedStatementAdapter(sqliteDb, sql, []);
    },

    async batch(statements) {
      sqliteDb.exec('BEGIN IMMEDIATE;');
      try {
        const results = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        sqliteDb.exec('COMMIT;');
        return results;
      } catch (err) {
        sqliteDb.exec('ROLLBACK;');
        throw err;
      }
    },

    async exec(sql) {
      sqliteDb.exec(sql);
      return { count: 1 };
    },

    close() {
      sqliteDb.close();
    }
  };
}
