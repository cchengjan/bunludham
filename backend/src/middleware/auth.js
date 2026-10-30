/**
 * Server-side session authentication & role authorization middleware.
 * Never trusts client-supplied member IDs, roles, or LINE user IDs.
 */

import { parseCookies, SESSION_COOKIE_NAME } from '../cookies.js';
import { deriveCsrfToken, sha256Hex } from '../crypto.js';
import { assertSessionSecretConfigured } from '../config.js';

export async function authenticateSession(request, env, config, { now = new Date() } = {}) {
  if (!env.DB || !assertSessionSecretConfigured(config)) {
    return { authenticated: false, reason: 'NOT_CONFIGURED' };
  }

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const rawSessionToken = cookies[SESSION_COOKIE_NAME];
  if (!rawSessionToken || typeof rawSessionToken !== 'string' || rawSessionToken.length < 24) {
    return { authenticated: false, reason: 'NO_COOKIE' };
  }

  const tokenHash = await sha256Hex(rawSessionToken);
  const nowIso = now.toISOString();

  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.token_hash AS session_token_hash,
       s.member_id AS session_member_id,
       s.created_at AS session_created_at,
       s.expires_at AS session_expires_at,
       s.last_seen_at AS session_last_seen_at,
       s.revoked_at AS session_revoked_at,
       m.id AS member_id,
       m.display_name AS member_display_name,
       m.display_name_customized AS member_display_name_customized,
       m.picture_url AS member_picture_url,
       m.email AS member_email,
       m.role AS member_role,
       m.status AS member_status,
       m.news_opt_in AS member_news_opt_in,
       m.preferred_frame_category AS member_preferred_frame_category,
       m.created_at AS member_created_at,
       m.updated_at AS member_updated_at,
       m.last_login_at AS member_last_login_at
     FROM sessions s
     INNER JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first();

  if (!row) {
    return { authenticated: false, reason: 'SESSION_NOT_FOUND', hadCookie: true };
  }

  if (row.session_revoked_at) {
    return { authenticated: false, reason: 'SESSION_REVOKED', hadCookie: true };
  }

  if (row.session_expires_at <= nowIso) {
    return { authenticated: false, reason: 'SESSION_EXPIRED', hadCookie: true };
  }

  if (row.member_status !== 'ACTIVE') {
    return { authenticated: false, reason: 'MEMBER_INACTIVE', hadCookie: true };
  }

  // Update last_seen_at without blocking if last update was within the same minute
  if (!row.session_last_seen_at || row.session_last_seen_at.slice(0, 16) !== nowIso.slice(0, 16)) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
      .bind(nowIso, row.session_id)
      .run();
  }

  const csrfToken = await deriveCsrfToken(
    config.sessionSecret,
    row.session_id,
    row.session_token_hash
  );

  return {
    authenticated: true,
    csrfToken,
    session: {
      id: row.session_id,
      tokenHash: row.session_token_hash,
      createdAt: row.session_created_at,
      expiresAt: row.session_expires_at
    },
    member: {
      id: row.member_id,
      displayName: row.member_display_name,
      displayNameCustomized: Boolean(row.member_display_name_customized),
      pictureUrl: row.member_picture_url || null,
      email: row.member_email || null,
      role: row.member_role,
      status: row.member_status,
      newsOptIn: Boolean(row.member_news_opt_in),
      preferredFrameCategory: row.member_preferred_frame_category || null,
      createdAt: row.member_created_at,
      updatedAt: row.member_updated_at,
      lastLoginAt: row.member_last_login_at
    }
  };
}
