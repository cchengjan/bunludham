/**
 * Member Profile & Consent Management Routes:
 * - GET   /api/v1/members/me
 * - PATCH /api/v1/members/me
 * - GET   /api/v1/members/me/consents
 * - PUT   /api/v1/members/me/consents
 *
 * Strictly scoped to the authenticated session's internal member_id.
 */

import { buildClearSessionCookie } from '../cookies.js';
import { generateEntityId, hashClientIp } from '../crypto.js';
import {
  errorResponse,
  getClientIp,
  jsonResponse,
  parseJsonBody
} from '../http.js';
import { authenticateSession } from '../middleware/auth.js';
import { checkRateLimit } from '../middleware/rate-limit.js';
import { verifyCsrfProtection } from '../middleware/security.js';
import { writeAuditLog } from '../services/audit.js';

const ALLOWED_PATCH_MEMBER_FIELDS = new Set([
  'displayName',
  'newsOptIn',
  'preferredFrameCategory'
]);

const ALLOWED_FRAME_CATEGORIES = new Set([
  'ทั้งหมด',
  'กฐิน',
  'มุทิตาสักการะ',
  'งานบุญ',
  'พิธี',
  'อื่น ๆ'
]);

const ALLOWED_CONSENT_TYPES = ['PRIVACY_POLICY', 'TERMS_OF_USE', 'NEWS_PR'];

function sanitizeDisplayName(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 1 || cleaned.length > 80) return null;
  return cleaned;
}

async function fetchMemberConsentsMap(db, memberId, policyVersion) {
  const res = await db
    .prepare(
      `SELECT consent_type, policy_version, granted, recorded_at, revoked_at, updated_at
       FROM consents
       WHERE member_id = ?`
    )
    .bind(memberId)
    .all();

  const rows = Array.isArray(res && res.results) ? res.results : [];
  const byType = Object.create(null);
  for (const r of rows) {
    byType[r.consent_type] = {
      consentType: r.consent_type,
      policyVersion: r.policy_version,
      granted: Boolean(r.granted),
      recordedAt: r.recorded_at || null,
      revokedAt: r.revoked_at || null,
      updatedAt: r.updated_at || null
    };
  }

  return ALLOWED_CONSENT_TYPES.map((type) => (
    byType[type] || {
      consentType: type,
      policyVersion,
      granted: false,
      recordedAt: null,
      revokedAt: null,
      updatedAt: null
    }
  ));
}

async function upsertConsentRow(db, {
  memberId,
  consentType,
  policyVersion,
  granted,
  nowIso
}) {
  const existing = await db
    .prepare('SELECT id, recorded_at FROM consents WHERE member_id = ? AND consent_type = ?')
    .bind(memberId, consentType)
    .first();

  if (existing) {
    const nextRecordedAt = granted ? nowIso : existing.recorded_at;
    const nextRevokedAt = granted ? null : nowIso;
    await db
      .prepare(
        `UPDATE consents
         SET policy_version = ?, granted = ?, recorded_at = ?, revoked_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(policyVersion, granted ? 1 : 0, nextRecordedAt, nextRevokedAt, nowIso, existing.id)
      .run();
  } else {
    const id = generateEntityId('con');
    await db
      .prepare(
        `INSERT INTO consents (
           id, member_id, consent_type, policy_version, granted, recorded_at, revoked_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        memberId,
        consentType,
        policyVersion,
        granted ? 1 : 0,
        nowIso,
        granted ? null : nowIso,
        nowIso
      )
      .run();
  }
}

async function buildFullMemberPayload(db, memberId, policyVersion) {
  const memberRow = await db
    .prepare(
      `SELECT
         id, display_name, display_name_customized, picture_url,
         role, status, news_opt_in, preferred_frame_category,
         created_at, updated_at, last_login_at
       FROM members
       WHERE id = ?`
    )
    .bind(memberId)
    .first();

  if (!memberRow) return null;

  const providerRes = await db
    .prepare(
      `SELECT provider, provider_display_name, last_login_at
       FROM auth_identities
       WHERE member_id = ?`
    )
    .bind(memberId)
    .all();

  const providers = (providerRes && Array.isArray(providerRes.results) ? providerRes.results : []).map((p) => ({
    provider: p.provider,
    providerDisplayName: p.provider_display_name || null,
    lastLoginAt: p.last_login_at || null
  }));

  const consents = await fetchMemberConsentsMap(db, memberId, policyVersion);

  return {
    id: memberRow.id,
    displayName: memberRow.display_name,
    displayNameCustomized: Boolean(memberRow.display_name_customized),
    pictureUrl: memberRow.picture_url || null,
    role: memberRow.role,
    status: memberRow.status,
    newsOptIn: Boolean(memberRow.news_opt_in),
    preferredFrameCategory: memberRow.preferred_frame_category || null,
    createdAt: memberRow.created_at,
    updatedAt: memberRow.updated_at,
    lastLoginAt: memberRow.last_login_at,
    linkedProviders: providers,
    consents
  };
}

function unauthorizedMemberResponse(request, config, auth) {
  const cookies = auth && auth.hadCookie ? [buildClearSessionCookie(request, config)] : [];
  return errorResponse(
    401,
    auth && auth.reason === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
    'กรุณาเข้าสู่ระบบด้วย LINE ก่อนเข้าถึงข้อมูลสมาชิก',
    { request, config, setCookies: cookies }
  );
}

/**
 * GET /api/v1/members/me
 */
export async function handleGetMemberMe(request, env, config) {
  const auth = await authenticateSession(request, env, config);
  if (!auth.authenticated) {
    return unauthorizedMemberResponse(request, config, auth);
  }

  const profile = await buildFullMemberPayload(env.DB, auth.member.id, config.policyVersion);
  return jsonResponse({
    ok: true,
    member: profile
  }, {
    status: 200,
    request,
    config,
    noStore: true
  });
}

/**
 * PATCH /api/v1/members/me
 */
export async function handlePatchMemberMe(request, env, config) {
  const auth = await authenticateSession(request, env, config);
  if (!auth.authenticated) {
    return unauthorizedMemberResponse(request, config, auth);
  }

  const csrfCheck = await verifyCsrfProtection(request, config, auth);
  if (!csrfCheck.ok) {
    return errorResponse(csrfCheck.status, csrfCheck.code, csrfCheck.message, { request, config });
  }

  const rate = await checkRateLimit(env.DB, `member_patch:${auth.member.id}`, {
    limit: 30,
    windowMs: 60_000
  });
  if (!rate.allowed) {
    return errorResponse(
      429,
      'RATE_LIMITED',
      'มีการบันทึกข้อมูลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
      {
        request,
        config,
        extraHeaders: { 'Retry-After': String(rate.retryAfterSeconds) }
      }
    );
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(parsed.status, parsed.code, parsed.message, { request, config });
  }

  const body = parsed.data;
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return errorResponse(400, 'EMPTY_UPDATE', 'กรุณาระบุข้อมูลที่ต้องการแก้ไขอย่างน้อย 1 รายการ', {
      request,
      config
    });
  }

  const disallowedKeys = keys.filter((k) => !ALLOWED_PATCH_MEMBER_FIELDS.has(k));
  if (disallowedKeys.length > 0) {
    return errorResponse(
      400,
      'FORBIDDEN_OR_UNKNOWN_FIELD',
      `ไม่อนุญาตให้แก้ไขฟิลด์ต่อไปนี้: ${disallowedKeys.join(', ')}`,
      { request, config, details: { rejectedFields: disallowedKeys } }
    );
  }

  const updates = [];
  const values = [];
  const changedFields = [];
  const now = new Date();
  const nowIso = now.toISOString();

  if (Object.prototype.hasOwnProperty.call(body, 'displayName')) {
    const cleanName = sanitizeDisplayName(body.displayName);
    if (!cleanName) {
      return errorResponse(
        400,
        'INVALID_DISPLAY_NAME',
        'ชื่อที่แสดงต้องมีความยาวระหว่าง 1 ถึง 80 ตัวอักษร',
        { request, config }
      );
    }
    updates.push('display_name = ?', 'display_name_customized = 1');
    values.push(cleanName);
    changedFields.push('displayName');
  }

  let syncNewsConsent = null;
  if (Object.prototype.hasOwnProperty.call(body, 'newsOptIn')) {
    if (typeof body.newsOptIn !== 'boolean') {
      return errorResponse(
        400,
        'INVALID_NEWS_OPT_IN',
        'ค่าการรับข่าวสาร (newsOptIn) ต้องเป็น true หรือ false เท่านั้น',
        { request, config }
      );
    }
    updates.push('news_opt_in = ?');
    values.push(body.newsOptIn ? 1 : 0);
    syncNewsConsent = body.newsOptIn;
    changedFields.push('newsOptIn');
  }

  if (Object.prototype.hasOwnProperty.call(body, 'preferredFrameCategory')) {
    const cat = body.preferredFrameCategory;
    if (cat !== null && (typeof cat !== 'string' || !ALLOWED_FRAME_CATEGORIES.has(cat))) {
      return errorResponse(
        400,
        'INVALID_FRAME_CATEGORY',
        'หมวดหมู่กรอบรูปที่เลือกไม่ถูกต้อง',
        { request, config }
      );
    }
    updates.push('preferred_frame_category = ?');
    values.push(cat);
    changedFields.push('preferredFrameCategory');
  }

  updates.push('updated_at = ?');
  values.push(nowIso);
  values.push(auth.member.id);

  await env.DB.prepare(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  if (syncNewsConsent !== null) {
    await upsertConsentRow(env.DB, {
      memberId: auth.member.id,
      consentType: 'NEWS_PR',
      policyVersion: config.policyVersion,
      granted: syncNewsConsent,
      nowIso
    });
  }

  const ipHash = await hashClientIp(config.sessionSecret, getClientIp(request));
  await writeAuditLog(env.DB, {
    eventType: 'MEMBER_PROFILE_UPDATED',
    memberId: auth.member.id,
    actorType: 'MEMBER',
    ipHash,
    metadata: { changedFields },
    now
  });

  const updatedProfile = await buildFullMemberPayload(env.DB, auth.member.id, config.policyVersion);
  return jsonResponse({
    ok: true,
    member: updatedProfile
  }, {
    status: 200,
    request,
    config,
    noStore: true
  });
}

/**
 * GET /api/v1/members/me/consents
 */
export async function handleGetMemberConsents(request, env, config) {
  const auth = await authenticateSession(request, env, config);
  if (!auth.authenticated) {
    return unauthorizedMemberResponse(request, config, auth);
  }

  const consents = await fetchMemberConsentsMap(env.DB, auth.member.id, config.policyVersion);
  return jsonResponse({
    ok: true,
    currentPolicyVersion: config.policyVersion,
    consents
  }, {
    status: 200,
    request,
    config,
    noStore: true
  });
}

/**
 * PUT /api/v1/members/me/consents
 */
export async function handlePutMemberConsents(request, env, config) {
  const auth = await authenticateSession(request, env, config);
  if (!auth.authenticated) {
    return unauthorizedMemberResponse(request, config, auth);
  }

  const csrfCheck = await verifyCsrfProtection(request, config, auth);
  if (!csrfCheck.ok) {
    return errorResponse(csrfCheck.status, csrfCheck.code, csrfCheck.message, { request, config });
  }

  const rate = await checkRateLimit(env.DB, `member_consents:${auth.member.id}`, {
    limit: 30,
    windowMs: 60_000
  });
  if (!rate.allowed) {
    return errorResponse(
      429,
      'RATE_LIMITED',
      'มีการบันทึกความยินยอมถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
      {
        request,
        config,
        extraHeaders: { 'Retry-After': String(rate.retryAfterSeconds) }
      }
    );
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return errorResponse(parsed.status, parsed.code, parsed.message, { request, config });
  }

  const body = parsed.data;
  const topKeys = Object.keys(body);
  const unknownTop = topKeys.filter((k) => k !== 'consents' && k !== 'policyVersion');
  if (unknownTop.length > 0) {
    return errorResponse(
      400,
      'UNKNOWN_CONSENT_PAYLOAD_FIELD',
      `ไม่รู้จักฟิลด์: ${unknownTop.join(', ')}`,
      { request, config }
    );
  }

  if (!body.consents || typeof body.consents !== 'object' || Array.isArray(body.consents)) {
    return errorResponse(
      400,
      'INVALID_CONSENTS_OBJECT',
      'กรุณาระบุข้อมูลความยินยอมในรูปแบบออบเจ็กต์ consents',
      { request, config }
    );
  }

  const consentEntries = Object.entries(body.consents);
  if (consentEntries.length === 0) {
    return errorResponse(
      400,
      'EMPTY_CONSENTS',
      'กรุณาระบุประเภทความยินยอมอย่างน้อย 1 รายการ',
      { request, config }
    );
  }

  for (const [type, val] of consentEntries) {
    if (!ALLOWED_CONSENT_TYPES.includes(type)) {
      return errorResponse(
        400,
        'UNSUPPORTED_CONSENT_TYPE',
        `ไม่รองรับประเภทความยินยอม: ${type}`,
        { request, config }
      );
    }
    if (typeof val !== 'boolean') {
      return errorResponse(
        400,
        'INVALID_CONSENT_VALUE',
        `ค่าความยินยอมของ ${type} ต้องเป็น true หรือ false เท่านั้น`,
        { request, config }
      );
    }
  }

  let policyVersion = config.policyVersion;
  if (body.policyVersion !== undefined) {
    if (typeof body.policyVersion !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(body.policyVersion)) {
      return errorResponse(
        400,
        'INVALID_POLICY_VERSION',
        'รูปแบบรหัสเวอร์ชันนโยบายความเป็นส่วนตัวไม่ถูกต้อง',
        { request, config }
      );
    }
    policyVersion = body.policyVersion;
  }

  const now = new Date();
  const nowIso = now.toISOString();

  for (const [type, granted] of consentEntries) {
    await upsertConsentRow(env.DB, {
      memberId: auth.member.id,
      consentType: type,
      policyVersion,
      granted,
      nowIso
    });

    if (type === 'NEWS_PR') {
      await env.DB.prepare('UPDATE members SET news_opt_in = ?, updated_at = ? WHERE id = ?')
        .bind(granted ? 1 : 0, nowIso, auth.member.id)
        .run();
    }
  }

  const ipHash = await hashClientIp(config.sessionSecret, getClientIp(request));
  await writeAuditLog(env.DB, {
    eventType: 'MEMBER_CONSENT_UPDATED',
    memberId: auth.member.id,
    actorType: 'MEMBER',
    ipHash,
    metadata: {
      policyVersion,
      updatedTypes: consentEntries.map(([t, g]) => ({ type: t, granted: g }))
    },
    now
  });

  const consents = await fetchMemberConsentsMap(env.DB, auth.member.id, config.policyVersion);
  return jsonResponse({
    ok: true,
    currentPolicyVersion: config.policyVersion,
    consents
  }, {
    status: 200,
    request,
    config,
    noStore: true
  });
}
