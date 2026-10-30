/**
 * CSRF & Origin verification middleware for cookie-authenticated state-changing endpoints.
 * Enforces both Origin allowlist validation and constant-time session-bound X-CSRF-Token check.
 */

import { isAllowedOrigin } from '../config.js';
import { deriveCsrfToken, timingSafeEqualStr } from '../crypto.js';

export async function verifyCsrfProtection(request, config, sessionContext) {
  const origin = request.headers.get('Origin');
  if (!origin || !isAllowedOrigin(origin, config)) {
    return {
      ok: false,
      status: 403,
      code: 'CSRF_ORIGIN_INVALID',
      message: 'ไม่อนุญาตคำขอเปลี่ยนแปลงข้อมูลจากต้นทางที่ไม่ได้รับอนุญาต'
    };
  }

  if (!sessionContext || !sessionContext.session) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ'
    };
  }

  const providedToken = request.headers.get('X-CSRF-Token') || '';
  if (!providedToken) {
    return {
      ok: false,
      status: 403,
      code: 'CSRF_TOKEN_MISSING',
      message: 'ไม่พบโทเค็นป้องกัน CSRF (X-CSRF-Token)'
    };
  }

  const expectedToken = await deriveCsrfToken(
    config.sessionSecret,
    sessionContext.session.id,
    sessionContext.session.tokenHash
  );

  if (!timingSafeEqualStr(providedToken, expectedToken)) {
    return {
      ok: false,
      status: 403,
      code: 'CSRF_TOKEN_INVALID',
      message: 'โทเค็นป้องกัน CSRF ไม่ถูกต้องหรือหมดอายุ'
    };
  }

  return { ok: true };
}
