/**
 * Idempotent SQL Migration & Development Seed Runner for SQLite / D1.
 * Tracks applied migration versions and SHA-256 checksums in `schema_migrations`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
export const DEFAULT_SEED_FILE = path.resolve(__dirname, '../../seeds/dev_seed.sql');

export async function runMigrations(db, { migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const applied = [];
  const skipped = [];

  for (const filename of files) {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    const version = match ? match[1] : filename;
    const name = match ? match[2] : filename;
    const fullPath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const checksum = await sha256Hex(sql);

    const existing = await db
      .prepare('SELECT version, checksum FROM schema_migrations WHERE version = ?')
      .bind(version)
      .first();

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `MIGRATION_CHECKSUM_MISMATCH: Migration ${filename} was modified after being applied.`
        );
      }
      skipped.push(filename);
      continue;
    }

    const nowIso = new Date().toISOString();
    await db.exec('BEGIN IMMEDIATE;');
    try {
      await db.exec(sql);
      await db
        .prepare(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(version, name, checksum, nowIso)
        .run();
      await db.exec('COMMIT;');
      applied.push(filename);
    } catch (err) {
      await db.exec('ROLLBACK;');
      throw err;
    }
  }

  return { applied, skipped };
}

export async function applyDevSeed(db, {
  appEnv = 'development',
  seedFile = DEFAULT_SEED_FILE
} = {}) {
  if (appEnv === 'production' || appEnv === 'staging') {
    throw new Error('DEV_SEED_FORBIDDEN_IN_PRODUCTION');
  }
  const sql = fs.readFileSync(seedFile, 'utf8');
  await db.exec(sql);
  return { seeded: true, seedFile };
}
