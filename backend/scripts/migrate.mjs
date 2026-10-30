#!/usr/bin/env node
/**
 * CLI tool to apply local SQLite / D1 migrations and optional dev seed.
 * Usage:
 *   node ./scripts/migrate.mjs
 *   node ./scripts/migrate.mjs --seed
 *   node ./scripts/migrate.mjs --db /custom/path.sqlite
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteD1Adapter } from '../src/db/d1-sqlite-adapter.js';
import { applyDevSeed, runMigrations } from '../src/db/migrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.resolve(__dirname, '../.local/dev.sqlite');

const args = process.argv.slice(2);
const wantSeed = args.includes('--seed');
const dbFlagIdx = args.indexOf('--db');
const dbPath = dbFlagIdx >= 0 && args[dbFlagIdx + 1]
  ? path.resolve(args[dbFlagIdx + 1])
  : defaultDbPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = createSqliteD1Adapter(dbPath);
try {
  const result = await runMigrations(db);
  console.log(JSON.stringify({
    event: 'db.migrations.completed',
    dbPath,
    applied: result.applied,
    skipped: result.skipped
  }));

  if (wantSeed) {
    const appEnv = process.env.APP_ENV || 'development';
    await applyDevSeed(db, { appEnv });
    console.log(JSON.stringify({
      event: 'db.seed.completed',
      dbPath
    }));
  }
} finally {
  db.close();
}
