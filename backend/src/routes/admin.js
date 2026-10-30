/**
 * Server-Verified Admin Route (`GET /api/v1/admin/stats`).
 *
 * Demonstrates strict server-side RBAC:
 * - Authenticates opaque session cookie from DB
 * - Requires `member.role === 'ADMIN'` in DB (LINE Login alone NEVER grants ADMIN)
 * - Never trusts client-side LocalStorage/sessionStorage PIN flags
 */

import { buildClearSessionCookie } from '../cookies.js';
import { hashClientIp } from '../crypto.js';
import { errorResponse, getClientIp, jsonResponse } from '../http.js';
import { authenticateSession } from '../middleware/auth.js';
import { writeAuditLog } from '../services/audit.js';

export async function handleAdminStats(request, env, config) {
  const auth = await authenticateSession(request, env, config);
  if (!auth.authenticated) {
    const cookies = auth && auth.hadCookie ? [buildClearSessionCookie(request, config)] : [];
    return errorResponse(
      401,
      'UNAUTHENTICATED',
      'กรุณาเข้าสู่ระบบก่อนเข้าถึงข้อมูลผู้ดูแลระบบ',
      { request, config, setCookies: cookies }
    );
  }

  if (auth.member.role !== 'ADMIN') {
    const ipHash = await hashClientIp(config.sessionSecret, getClientIp(request));
    await writeAuditLog(env.DB, {
      eventType: 'ADMIN_ACCESS_DENIED',
      memberId: auth.member.id,
      actorType: 'MEMBER',
      ipHash,
      metadata: { path: '/api/v1/admin/stats', role: auth.member.role }
    });
    return errorResponse(
      403,
      'FORBIDDEN_ADMIN_ONLY',
      'เฉพาะผู้ดูแลระบบที่ได้รับอนุมัติสิทธิ์จากเซิร์ฟเวอร์ (ADMIN) เท่านั้น',
      { request, config }
    );
  }

  const nowIso = new Date().toISOString();
  const totalRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM members WHERE status = 'ACTIVE'"
  ).first();
  const optInRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM members WHERE status = 'ACTIVE' AND news_opt_in = 1"
  ).first();
  const sessionsRow = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM sessions WHERE revoked_at IS NULL AND expires_at > ?'
  ).bind(nowIso).first();

  return jsonResponse({
    ok: true,
    stats: {
      totalActiveMembers: totalRow ? Number(totalRow.cnt) : 0,
      newsOptInMembers: optInRow ? Number(optInRow.cnt) : 0,
      activeSessions: sessionsRow ? Number(sessionsRow.cnt) : 0
    }
  }, {
    status: 200,
    request,
    config,
    noStore: true
  });
}
