/**
 * Official LINE Login v2.1 + OIDC Authentication & Session Routes:
 * - GET  /api/v1/auth/line/start
 * - GET  /api/v1/auth/line/callback
 * - GET  /api/v1/auth/me
 * - POST /api/v1/auth/logout
 */

import {
  assertLineOAuthConfigured,
  isAllowedOrigin,
  resolveSafeReturnTo
} from '../config.js';
import {
  buildClearOAuthTxCookie,
  buildClearSessionCookie,
  buildOAuthTxSetCookie,
  buildSessionSetCookie,
  OAUTH_TX_COOKIE_NAME,
  parseCookies,
  SESSION_COOKIE_NAME
} from '../cookies.js';
import {
  generateEntityId,
  hashClientIp,
  randomAlphanumeric,
  randomBase64Url,
  sha256Hex
} from '../crypto.js';
import {
  errorResponse,
  getClientIp,
  jsonResponse,
  redirectResponse,
  summarizeUserAgent
} from '../http.js';
import { authenticateSession } from '../middleware/auth.js';
import { checkRateLimit } from '../middleware/rate-limit.js';
import { verifyCsrfProtection } from '../middleware/security.js';
import { writeAuditLog } from '../services/audit.js';
import {
  buildLineAuthorizeUrl,
  exchangeLineAuthorizationCode,
  verifyLineIdToken
} from '../services/line-oauth.js';

function appendQueryParam(baseUrl, key, value) {
  const url = new URL(baseUrl);
  url.searchParams.set(key, value);
  return url.toString();
}

function getDefaultFrontendUrl(config) {
  if (!config.frontendOrigin) return '/';
  return `${config.frontendOrigin}${config.frontendBasePath || ''}/`;
}

function getChangesCount(runResult) {
  if (!runResult) return 0;
  if (runResult.meta && typeof runResult.meta.changes === 'number') {
    return runResult.meta.changes;
  }
  if (typeof runResult.changes === 'number') {
    return runResult.changes;
  }
  return 0;
}

/**
 * GET /api/v1/auth/line/start
 */
export async function handleLineAuthStart(request, env, config, logger) {
  const url = new URL(request.url);
  const rawReturnTo = url.searchParams.get('return_to');
  const resolvedReturn = resolveSafeReturnTo(rawReturnTo, config);

  if (!resolvedReturn.ok) {
    logger.warn('auth.line.start.invalid_return_to', {
      reason: resolvedReturn.error
    });
    return errorResponse(
      400,
      'INVALID_RETURN_TO',
      'URL ปลายทางหลังเข้าสู่ระบบไม่อยู่ในรายการที่อนุญาต',
      { request, config }
    );
  }

  const ipHash = await hashClientIp(config.sessionSecret, getClientIp(request));
  const rate = await checkRateLimit(env.DB, `auth_start:${ipHash || 'anon'}`, {
    limit: 20,
    windowMs: 60_000
  });
  if (!rate.allowed) {
    return errorResponse(
      429,
      'RATE_LIMITED',
      'มีการร้องขอเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      {
        request,
        config,
        extraHeaders: { 'Retry-After': String(rate.retryAfterSeconds) }
      }
    );
  }

  const oauthCheck = assertLineOAuthConfigured(config);
  if (!oauthCheck.ok) {
    logger.warn('auth.line.start.not_configured', { missing: oauthCheck.missing });
    const accept = request.headers.get('Accept') || '';
    if (accept.includes('text/html')) {
      return redirectResponse(appendQueryParam(resolvedReturn.url, 'auth_error', 'oauth_not_configured'));
    }
    return errorResponse(
      503,
      'LINE_OAUTH_NOT_CONFIGURED',
      'ระบบเข้าสู่ระบบด้วย LINE ยังไม่ได้ตั้งค่าข้อมูลเชื่อมต่อบนเซิร์ฟเวอร์',
      { request, config }
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + config.oauthStateTtlSeconds * 1000).toISOString();

  // Opportunistic cleanup of expired OAuth transactions
  await env.DB.prepare('DELETE FROM oauth_transactions WHERE expires_at <= ?')
    .bind(nowIso)
    .run();

  const state = randomAlphanumeric(43);
  const txToken = randomBase64Url(32);
  const nonce = randomBase64Url(32);
  const codeVerifier = randomBase64Url(32);

  const stateHash = await sha256Hex(state);
  const txTokenHash = await sha256Hex(txToken);
  const txId = generateEntityId('otx');

  await env.DB.prepare(
    `INSERT INTO oauth_transactions (
       id, provider, state_hash, tx_token_hash, nonce, code_verifier, return_to, created_at, expires_at, ip_hash
     ) VALUES (?, 'line', ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      txId,
      stateHash,
      txTokenHash,
      nonce,
      codeVerifier,
      resolvedReturn.url,
      nowIso,
      expiresAtIso,
      ipHash
    )
    .run();

  await writeAuditLog(env.DB, {
    eventType: 'AUTH_LINE_START',
    actorType: 'ANONYMOUS',
    ipHash,
    metadata: { transactionId: txId },
    now
  });

  const authorizeUrl = await buildLineAuthorizeUrl({
    channelId: config.lineChannelId,
    redirectUri: config.lineRedirectUri,
    state,
    nonce,
    codeVerifier
  });

  const txSetCookie = buildOAuthTxSetCookie(txToken, request, config);
  return redirectResponse(authorizeUrl, {
    status: 302,
    setCookies: [txSetCookie]
  });
}

/**
 * GET /api/v1/auth/line/callback
 */
export async function handleLineAuthCallback(request, env, config, logger) {
  const clearTxCookie = buildClearOAuthTxCookie(request, config);
  const defaultFrontendUrl = getDefaultFrontendUrl(config);

  const ipHash = await hashClientIp(config.sessionSecret, getClientIp(request));
  const rate = await checkRateLimit(env.DB, `auth_callback:${ipHash || 'anon'}`, {
    limit: 20,
    windowMs: 60_000
  });
  if (!rate.allowed) {
    return errorResponse(
      429,
      'RATE_LIMITED',
      'มีการร้องขอเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
      {
        request,
        config,
        setCookies: [clearTxCookie],
        extraHeaders: { 'Retry-After': String(rate.retryAfterSeconds) }
      }
    );
  }

  const oauthCheck = assertLineOAuthConfigured(config);
  if (!oauthCheck.ok) {
    return errorResponse(
      503,
      'LINE_OAUTH_NOT_CONFIGURED',
      'ระบบเข้าสู่ระบบด้วย LINE ยังไม่ได้ตั้งค่าข้อมูลเชื่อมต่อบนเซิร์ฟเวอร์',
      { request, config, setCookies: [clearTxCookie] }
    );
  }

  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const oauthError = url.searchParams.get('error') || '';

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const txToken = cookies[OAUTH_TX_COOKIE_NAME] || '';

  if (!/^[A-Za-z0-9]{24,128}$/.test(state) || typeof txToken !== 'string' || txToken.length < 24) {
    logger.warn('auth.line.callback.invalid_state_or_cookie', {
      hasState: Boolean(state),
      hasTxCookie: Boolean(txToken)
    });
    await writeAuditLog(env.DB, {
      eventType: 'AUTH_LINE_FAILURE',
      actorType: 'ANONYMOUS',
      ipHash,
      metadata: { reason: 'missing_or_malformed_state_or_cookie' }
    });
    return redirectResponse(appendQueryParam(defaultFrontendUrl, 'auth_error', 'invalid_state'), {
      status: 302,
      setCookies: [clearTxCookie]
    });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const nowSec = Math.floor(now.getTime() / 1000);
  const stateHash = await sha256Hex(state);
  const txTokenHash = await sha256Hex(txToken);

  // Atomic single-use state consumption (prevents race conditions and state replay)
  const consumeResult = await env.DB.prepare(
    `UPDATE oauth_transactions
     SET consumed_at = ?
     WHERE state_hash = ?
       AND tx_token_hash = ?
       AND consumed_at IS NULL
       AND expires_at > ?`
  )
    .bind(nowIso, stateHash, txTokenHash, nowIso)
    .run();

  if (getChangesCount(consumeResult) !== 1) {
    const existingTx = await env.DB.prepare(
      'SELECT tx_token_hash, expires_at, consumed_at, return_to FROM oauth_transactions WHERE state_hash = ?'
    )
      .bind(stateHash)
      .first();

    let failureReason = 'unknown_state';
    let clientErrorCode = 'invalid_state';
    if (existingTx) {
      if (existingTx.tx_token_hash !== txTokenHash) {
        failureReason = 'tx_cookie_mismatch';
        clientErrorCode = 'invalid_state';
      } else if (existingTx.consumed_at) {
        failureReason = 'replayed_state';
        clientErrorCode = 'invalid_state';
      } else if (existingTx.expires_at <= nowIso) {
        failureReason = 'expired_state';
        clientErrorCode = 'expired_state';
      }
    }

    logger.warn('auth.line.callback.state_rejected', { reason: failureReason });
    await writeAuditLog(env.DB, {
      eventType: 'AUTH_LINE_FAILURE',
      actorType: 'ANONYMOUS',
      ipHash,
      metadata: { reason: failureReason },
      now
    });

    return redirectResponse(appendQueryParam(defaultFrontendUrl, 'auth_error', clientErrorCode), {
      status: 302,
      setCookies: [clearTxCookie]
    });
  }

  const txRow = await env.DB.prepare(
    'SELECT id, nonce, code_verifier, return_to FROM oauth_transactions WHERE state_hash = ?'
  )
    .bind(stateHash)
    .first();

  const safeReturnCheck = resolveSafeReturnTo(txRow ? txRow.return_to : '', config);
  const safeReturnUrl = safeReturnCheck.ok ? safeReturnCheck.url : defaultFrontendUrl;

  if (oauthError) {
    const isCancelled = oauthError === 'access_denied';
    const errorTag = isCancelled ? 'cancelled' : 'provider_error';
    logger.info('auth.line.callback.oauth_error', { oauthError, isCancelled });
    await writeAuditLog(env.DB, {
      eventType: isCancelled ? 'AUTH_LINE_CANCELLED' : 'AUTH_LINE_FAILURE',
      actorType: 'ANONYMOUS',
      ipHash,
      metadata: { reason: oauthError },
      now
    });
    return redirectResponse(appendQueryParam(safeReturnUrl, 'auth_error', errorTag), {
      status: 302,
      setCookies: [clearTxCookie]
    });
  }

  if (!code || code.length > 512) {
    await writeAuditLog(env.DB, {
      eventType: 'AUTH_LINE_FAILURE',
      actorType: 'ANONYMOUS',
      ipHash,
      metadata: { reason: 'missing_or_invalid_code' },
      now
    });
    return redirectResponse(appendQueryParam(safeReturnUrl, 'auth_error', 'missing_code'), {
      status: 302,
      setCookies: [clearTxCookie]
    });
  }

  const fetchImpl = typeof env.__FETCH_IMPL === 'function' ? env.__FETCH_IMPL : globalThis.fetch;

  let tokenResponse;
  try {
    tokenResponse = await exchangeLineAuthorizationCode({
      code,
      codeVerifier: txRow.code_verifier,
      channelId: config.lineChannelId,
      channelSecret: config.lineChannelSecret,
      redirectUri: config.lineRedirectUri,
      fetchImpl
    });
  } catch (err) {
    logger.warn('auth.line.callback.token_exchange_failed', {
      reason: err.code || err.message,
      upstreamStatus: err.upstreamStatus || null,
      upstreamError: err.upstreamError || null
    });
    await writeAuditLog(env.DB, {
      eventType: 'AUTH_LINE_FAILURE',
      actorType: 'ANONYMOUS',
      ipHash,
      metadata: { reason: err.code || 'token_exchange_failed' },
      now
    });
    return redirectResponse(appendQueryParam(safeReturnUrl, 'auth_error', 'token_exchange_failed'), {
      status: 302,
      setCookies: [clearTxCookie]
    });
  }

  let verifiedIdentity;
  try {
    verifiedIdentity = await verifyLineIdToken({
      idToken: tokenResponse.idToken,
      channelId: config.lineChannelId,
      channelSecret: config.lineChannelSecret,
      expectedNonce: txRow.nonce,
      nowSec,
      fetchImpl
    });
  } catch (err) {
    logger.warn('auth.line.callback.id_token_invalid', {
      reason: err.code || err.message
    });
    await writeAuditLog(env.DB, {
      eventType: 'AUTH_LINE_FAILURE',
      actorType: 'ANONYMOUS',
      ipHash,
      metadata: { reason: err.code || err.message || 'id_token_invalid' },
      now
    });
    return redirectResponse(appendQueryParam(safeReturnUrl, 'auth_error', 'invalid_id_token'), {
      status: 302,
      setCookies: [clearTxCookie]
    });
  }

  // Resolve or create internal member record (never uses LINE subject as internal member ID)
  let existingIdentity = await env.DB.prepare(
    `SELECT ai.id AS identity_id, ai.member_id, m.status AS member_status, m.display_name_customized
     FROM auth_identities ai
     INNER JOIN members m ON m.id = ai.member_id
     WHERE ai.provider = 'line' AND ai.provider_subject = ?`
  )
    .bind(verifiedIdentity.subject)
    .first();

  let memberId = null;
  let isNewMember = false;
  const amrJson = JSON.stringify(verifiedIdentity.amr || []);

  if (existingIdentity) {
    if (existingIdentity.member_status !== 'ACTIVE') {
      await writeAuditLog(env.DB, {
        eventType: 'AUTH_LINE_BLOCKED_INACTIVE_MEMBER',
        memberId: existingIdentity.member_id,
        actorType: 'MEMBER',
        ipHash,
        metadata: { status: existingIdentity.member_status },
        now
      });
      return redirectResponse(appendQueryParam(safeReturnUrl, 'auth_error', 'account_suspended'), {
        status: 302,
        setCookies: [clearTxCookie]
      });
    }

    memberId = existingIdentity.member_id;
    await env.DB.prepare(
      `UPDATE auth_identities
       SET provider_display_name = ?,
           provider_picture_url = ?,
           provider_amr_json = ?,
           updated_at = ?,
           last_login_at = ?
       WHERE id = ?`
    )
      .bind(
        verifiedIdentity.displayName,
        verifiedIdentity.pictureUrl,
        amrJson,
        nowIso,
        nowIso,
        existingIdentity.identity_id
      )
      .run();

    if (Number(existingIdentity.display_name_customized) === 1) {
      await env.DB.prepare(
        `UPDATE members
         SET picture_url = ?, updated_at = ?, last_login_at = ?
         WHERE id = ?`
      )
        .bind(verifiedIdentity.pictureUrl, nowIso, nowIso, memberId)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE members
         SET display_name = ?, picture_url = ?, updated_at = ?, last_login_at = ?
         WHERE id = ?`
      )
        .bind(verifiedIdentity.displayName, verifiedIdentity.pictureUrl, nowIso, nowIso, memberId)
        .run();
    }
  } else {
    memberId = generateEntityId('mem');
    const identityId = generateEntityId('ident');
    isNewMember = true;

    // LINE Login NEVER grants ADMIN role automatically — always 'MEMBER'
    await env.DB.prepare(
      `INSERT INTO members (
         id, display_name, display_name_customized, picture_url, email,
         role, status, news_opt_in, preferred_frame_category,
         created_at, updated_at, last_login_at
       ) VALUES (?, ?, 0, ?, NULL, 'MEMBER', 'ACTIVE', 0, NULL, ?, ?, ?)`
    )
      .bind(memberId, verifiedIdentity.displayName, verifiedIdentity.pictureUrl, nowIso, nowIso, nowIso)
      .run();

    await env.DB.prepare(
      `INSERT INTO auth_identities (
         id, member_id, provider, provider_subject,
         provider_display_name, provider_picture_url, provider_amr_json,
         created_at, updated_at, last_login_at
       ) VALUES (?, ?, 'line', ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        identityId,
        memberId,
        verifiedIdentity.subject,
        verifiedIdentity.displayName,
        verifiedIdentity.pictureUrl,
        amrJson,
        nowIso,
        nowIso,
        nowIso
      )
      .run();
  }

  // Session rotation: if caller already had an active session cookie, revoke it before issuing a new session
  const previousSessionToken = cookies[SESSION_COOKIE_NAME];
  if (previousSessionToken && typeof previousSessionToken === 'string' && previousSessionToken.length >= 24) {
    const prevHash = await sha256Hex(previousSessionToken);
    await env.DB.prepare(
      `UPDATE sessions
       SET revoked_at = ?, revoke_reason = 'ROTATED_ON_LOGIN'
       WHERE token_hash = ? AND revoked_at IS NULL`
    )
      .bind(nowIso, prevHash)
      .run();
  }

  // Opportunistic cleanup of expired sessions
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(nowIso)
    .run();

  const rawSessionToken = randomBase64Url(32);
  const sessionTokenHash = await sha256Hex(rawSessionToken);
  const sessionId = generateEntityId('ses');
  const sessionExpiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (
       id, token_hash, member_id, created_at, expires_at, last_seen_at,
       revoked_at, revoke_reason, ip_hash, user_agent_summary
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
  )
    .bind(
      sessionId,
      sessionTokenHash,
      memberId,
      nowIso,
      sessionExpiresAt,
      nowIso,
      ipHash,
      summarizeUserAgent(request)
    )
    .run();

  await writeAuditLog(env.DB, {
    eventType: 'AUTH_LINE_SUCCESS',
    memberId,
    actorType: 'MEMBER',
    ipHash,
    metadata: {
      isNewMember,
      idTokenAlg: verifiedIdentity.alg
    },
    now
  });

  const sessionSetCookie = buildSessionSetCookie(rawSessionToken, request, config);
  const successRedirectUrl = appendQueryParam(safeReturnUrl, 'auth_login', 'success');

  return redirectResponse(successRedirectUrl, {
    status: 302,
    setCookies: [sessionSetCookie, clearTxCookie]
  });
}

/**
 * GET /api/v1/auth/me
 */
export async function handleAuthMe(request, env, config) {
  const auth = await authenticateSession(request, env, config);

  if (!auth.authenticated) {
    // If browser presented an expired/revoked/unknown session cookie, return 401 and clear it
    if (auth.hadCookie) {
      return errorResponse(
        401,
        auth.reason === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'SESSION_INVALID',
        'เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
        {
          request,
          config,
          setCookies: [buildClearSessionCookie(request, config)]
        }
      );
    }

    // Anonymous guest without cookie receives clean unauthenticated state
    return jsonResponse({
      ok: true,
      authenticated: false,
      member: null,
      csrfToken: null
    }, {
      status: 200,
      request,
      config,
      noStore: true
    });
  }

  return jsonResponse({
    ok: true,
    authenticated: true,
    csrfToken: auth.csrfToken,
    session: {
      expiresAt: auth.session.expiresAt
    },
    member: {
      id: auth.member.id,
      displayName: auth.member.displayName,
      pictureUrl: auth.member.pictureUrl,
      role: auth.member.role,
      newsOptIn: auth.member.newsOptIn,
      preferredFrameCategory: auth.member.preferredFrameCategory
    }
  }, {
    status: 200,
    request,
    config,
    noStore: true
  });
}

/**
 * POST /api/v1/auth/logout
 */
export async function handleAuthLogout(request, env, config) {
  const origin = request.headers.get('Origin');
  if (!origin || !isAllowedOrigin(origin, config)) {
    return errorResponse(
      403,
      'CSRF_ORIGIN_INVALID',
      'ไม่อนุญาตคำขอออกจากระบบจากต้นทางที่ไม่ได้รับอนุญาต',
      { request, config }
    );
  }

  const auth = await authenticateSession(request, env, config);
  const clearCookie = buildClearSessionCookie(request, config);

  if (!auth.authenticated) {
    return jsonResponse({
      ok: true,
      loggedOut: true
    }, {
      status: 200,
      request,
      config,
      noStore: true,
      setCookies: [clearCookie]
    });
  }

  const csrfCheck = await verifyCsrfProtection(request, config, auth);
  if (!csrfCheck.ok) {
    return errorResponse(csrfCheck.status, csrfCheck.code, csrfCheck.message, {
      request,
      config
    });
  }

  const now = new Date();
  const ipHash = await hashClientIp(config.sessionSecret, getClientIp(request));

  await env.DB.prepare(
    `UPDATE sessions
     SET revoked_at = ?, revoke_reason = 'USER_LOGOUT'
     WHERE id = ? AND revoked_at IS NULL`
  )
    .bind(now.toISOString(), auth.session.id)
    .run();

  await writeAuditLog(env.DB, {
    eventType: 'AUTH_LOGOUT',
    memberId: auth.member.id,
    actorType: 'MEMBER',
    ipHash,
    metadata: { sessionId: auth.session.id },
    now
  });

  return jsonResponse({
    ok: true,
    loggedOut: true
  }, {
    status: 200,
    request,
    config,
    noStore: true,
    setCookies: [clearCookie]
  });
}
