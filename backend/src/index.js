/**
 * Bunludham Membership & LINE Login v2.1 API — Cloudflare Worker Entrypoint.
 *
 * Compatible with Cloudflare Workers (`export default { fetch }`) and local Node.js dev/test runner.
 */

import { loadConfig } from './config.js';
import { errorResponse, handleCorsPreflight } from './http.js';
import { createLogger } from './logger.js';
import { handleAdminStats } from './routes/admin.js';
import {
  handleAuthLogout,
  handleAuthMe,
  handleLineAuthCallback,
  handleLineAuthStart
} from './routes/auth.js';
import { handleHealthRequest } from './routes/health.js';
import {
  handleGetMemberConsents,
  handleGetMemberMe,
  handlePatchMemberMe,
  handlePutMemberConsents
} from './routes/members.js';

export async function handleApiRequest(request, env = {}) {
  const resolvedEnv = {
    ...env,
    DB: env.DB || env.bunludham_db
  };
  const config = loadConfig(resolvedEnv);
  const logger = createLogger(resolvedEnv);

  if (request.method === 'OPTIONS') {
    return handleCorsPreflight(request, config);
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return errorResponse(400, 'INVALID_REQUEST_URL', 'URL คำขอไม่ถูกต้อง', { request, config });
  }

  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  try {
    if (pathname === '/api/v1/health') {
      if (method !== 'GET') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET', { request, config });
      }
      return await handleHealthRequest(request, resolvedEnv, config, logger);
    }

    if (!resolvedEnv.DB) {
      return errorResponse(503, 'DATABASE_NOT_BOUND', 'ยังไม่ได้เชื่อมต่อฐานข้อมูลระบบสมาชิก', {
        request,
        config
      });
    }

    if (pathname === '/api/v1/auth/line/start') {
      if (method !== 'GET') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET', { request, config });
      }
      return await handleLineAuthStart(request, resolvedEnv, config, logger);
    }

    if (pathname === '/api/v1/auth/line/callback') {
      if (method !== 'GET') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET', { request, config });
      }
      return await handleLineAuthCallback(request, resolvedEnv, config, logger);
    }

    if (pathname === '/api/v1/auth/me') {
      if (method !== 'GET') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET', { request, config });
      }
      return await handleAuthMe(request, resolvedEnv, config, logger);
    }

    if (pathname === '/api/v1/auth/logout') {
      if (method !== 'POST') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด POST', { request, config });
      }
      return await handleAuthLogout(request, resolvedEnv, config, logger);
    }

    if (pathname === '/api/v1/members/me') {
      if (method === 'GET') {
        return await handleGetMemberMe(request, resolvedEnv, config, logger);
      }
      if (method === 'PATCH') {
        return await handlePatchMemberMe(request, resolvedEnv, config, logger);
      }
      return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET และ PATCH', {
        request,
        config
      });
    }

    if (pathname === '/api/v1/members/me/consents') {
      if (method === 'GET') {
        return await handleGetMemberConsents(request, resolvedEnv, config, logger);
      }
      if (method === 'PUT') {
        return await handlePutMemberConsents(request, resolvedEnv, config, logger);
      }
      return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET และ PUT', {
        request,
        config
      });
    }

    if (pathname === '/api/v1/admin/stats') {
      if (method !== 'GET') {
        return errorResponse(405, 'METHOD_NOT_ALLOWED', 'รองรับเฉพาะเมธอด GET', { request, config });
      }
      return await handleAdminStats(request, resolvedEnv, config, logger);
    }

    return errorResponse(404, 'NOT_FOUND', 'ไม่พบเส้นทาง API ที่ร้องขอ', { request, config });
  } catch (err) {
    logger.error('api.unhandled_exception', {
      method,
      pathname,
      error: err
    });
    return errorResponse(
      500,
      'INTERNAL_SERVER_ERROR',
      'เกิดข้อผิดพลาดภายในระบบชั่วคราว กรุณาลองใหม่อีกครั้ง',
      { request, config }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleApiRequest(request, env, ctx);
  }
};
