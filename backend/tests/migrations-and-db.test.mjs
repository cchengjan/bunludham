/**
 * Database Schema, Constraints, Foreign Keys & Migration Runner Tests (Phase E & G3).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSqliteD1Adapter } from '../src/db/d1-sqlite-adapter.js';
import { applyDevSeed, runMigrations } from '../src/db/migrator.js';

describe('Database Migrations, Seeds & Relational Integrity', () => {
  it('applies migrations idempotently and tracks SHA-256 checksums in schema_migrations', async () => {
    const db = createSqliteD1Adapter(':memory:');
    try {
      const firstRun = await runMigrations(db);
      assert.deepEqual(firstRun.applied, ['0001_initial_membership_schema.sql']);
      assert.deepEqual(firstRun.skipped, []);

      const secondRun = await runMigrations(db);
      assert.deepEqual(secondRun.applied, []);
      assert.deepEqual(secondRun.skipped, ['0001_initial_membership_schema.sql']);

      const row = await db
        .prepare('SELECT version, name, checksum FROM schema_migrations WHERE version = ?')
        .bind('0001')
        .first();
      assert.equal(row.version, '0001');
      assert.equal(row.name, 'initial_membership_schema');
      assert.equal(row.checksum.length, 64);
    } finally {
      db.close();
    }
  });

  it('detects tampered migration checksums and refuses to proceed', async () => {
    const db = createSqliteD1Adapter(':memory:');
    try {
      await runMigrations(db);
      await db
        .prepare("UPDATE schema_migrations SET checksum = '0000_tampered' WHERE version = '0001'")
        .run();

      await assert.rejects(
        () => runMigrations(db),
        /MIGRATION_CHECKSUM_MISMATCH/
      );
    } finally {
      db.close();
    }
  });

  it('allows dev seed in development and blocks dev seed in staging/production', async () => {
    const db = createSqliteD1Adapter(':memory:');
    try {
      await runMigrations(db);
      const seedRes = await applyDevSeed(db, { appEnv: 'development' });
      assert.equal(seedRes.seeded, true);

      // Idempotent second seed run
      await applyDevSeed(db, { appEnv: 'development' });

      const sample = await db
        .prepare('SELECT id, role FROM members WHERE id = ?')
        .bind('mem_dev_sample_0001')
        .first();
      assert.equal(sample.role, 'MEMBER');

      await assert.rejects(
        () => applyDevSeed(db, { appEnv: 'production' }),
        /DEV_SEED_FORBIDDEN_IN_PRODUCTION/
      );
      await assert.rejects(
        () => applyDevSeed(db, { appEnv: 'staging' }),
        /DEV_SEED_FORBIDDEN_IN_PRODUCTION/
      );
    } finally {
      db.close();
    }
  });

  it('enforces UNIQUE(provider, provider_subject), CHECK constraints, and Foreign Key cascades', async () => {
    const db = createSqliteD1Adapter(':memory:');
    try {
      await runMigrations(db);
      const nowIso = '2026-02-01T00:00:00.000Z';

      await db
        .prepare(
          `INSERT INTO members (id, display_name, role, status, news_opt_in, created_at, updated_at)
           VALUES ('mem_1', 'สมาชิกทดสอบ', 'MEMBER', 'ACTIVE', 0, ?, ?)`
        )
        .bind(nowIso, nowIso)
        .run();

      await db
        .prepare(
          `INSERT INTO auth_identities (id, member_id, provider, provider_subject, created_at, updated_at, last_login_at)
           VALUES ('id_1', 'mem_1', 'line', 'U_UNIQUE_LINE_SUB', ?, ?, ?)`
        )
        .bind(nowIso, nowIso, nowIso)
        .run();

      // Duplicate (provider, provider_subject) must fail
      await assert.rejects(
        () => db
          .prepare(
            `INSERT INTO auth_identities (id, member_id, provider, provider_subject, created_at, updated_at, last_login_at)
             VALUES ('id_2', 'mem_1', 'line', 'U_UNIQUE_LINE_SUB', ?, ?, ?)`
          )
          .bind(nowIso, nowIso, nowIso)
          .run()
      );

      // Invalid role CHECK constraint must fail
      await assert.rejects(
        () => db
          .prepare(
            `INSERT INTO members (id, display_name, role, status, news_opt_in, created_at, updated_at)
             VALUES ('mem_bad_role', 'ชื่อ', 'SUPERADMIN', 'ACTIVE', 0, ?, ?)`
          )
          .bind(nowIso, nowIso)
          .run()
      );

      // Insert session & audit log, then delete member -> session cascades, audit_log preserves row with member_id = NULL
      await db
        .prepare(
          `INSERT INTO sessions (id, token_hash, member_id, created_at, expires_at, last_seen_at)
           VALUES ('ses_1', 'hash_1', 'mem_1', ?, ?, ?)`
        )
        .bind(nowIso, '2026-03-01T00:00:00.000Z', nowIso)
        .run();

      await db
        .prepare(
          `INSERT INTO audit_logs (id, event_type, member_id, actor_type, created_at)
           VALUES ('aud_1', 'TEST_EVENT', 'mem_1', 'MEMBER', ?)`
        )
        .bind(nowIso)
        .run();

      await db.prepare("DELETE FROM members WHERE id = 'mem_1'").run();

      const sesAfter = await db.prepare("SELECT id FROM sessions WHERE id = 'ses_1'").first();
      const identAfter = await db.prepare("SELECT id FROM auth_identities WHERE id = 'id_1'").first();
      const audAfter = await db.prepare("SELECT id, member_id FROM audit_logs WHERE id = 'aud_1'").first();

      assert.equal(sesAfter, null, 'Session must cascade delete when member is deleted');
      assert.equal(identAfter, null, 'Auth identity must cascade delete when member is deleted');
      assert.ok(audAfter, 'Audit log must survive member deletion');
      assert.equal(audAfter.member_id, null, 'Audit log member_id must be set to NULL');
    } finally {
      db.close();
    }
  });
});
