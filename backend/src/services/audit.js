/**
 * Security & membership audit log writer.
 * Sanitizes metadata via redactValue before persisting to D1.
 */

import { generateEntityId } from '../crypto.js';
import { redactValue } from '../logger.js';

export async function writeAuditLog(db, {
  eventType,
  memberId = null,
  actorType = 'SYSTEM',
  ipHash = null,
  metadata = null,
  now = new Date()
} = {}) {
  if (!db || !eventType) return;

  const id = generateEntityId('aud');
  const metadataJson = metadata ? JSON.stringify(redactValue(metadata)) : null;

  await db
    .prepare(
      `INSERT INTO audit_logs (id, event_type, member_id, actor_type, ip_hash, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, eventType, memberId, actorType, ipHash, metadataJson, now.toISOString())
    .run();
}
