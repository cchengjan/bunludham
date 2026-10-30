/**
 * Health check route (`GET /api/v1/health`).
 * Reports database readiness and OAuth configuration status without leaking secrets.
 */

import { assertLineOAuthConfigured } from '../config.js';
import { errorResponse, jsonResponse } from '../http.js';

export async function handleHealthRequest(request, env, config, logger) {
  if (!env.DB) {
    return errorResponse(503, 'DATABASE_NOT_BOUND', 'ยังไม่ได้เชื่อมต่อฐานข้อมูลระบบสมาชิก', {
      request,
      config
    });
  }

  try {
    const row = await env.DB.prepare('SELECT 1 AS ok').first();
    if (!row || Number(row.ok) !== 1) {
      throw new Error('DB_PING_UNEXPECTED_RESULT');
    }

    const oauthCheck = assertLineOAuthConfigured(config);
    return jsonResponse({
      ok: true,
      service: 'bunludham-membership-api',
      version: '1.0.0',
      environment: config.appEnv,
      database: 'connected',
      lineLoginConfigured: oauthCheck.ok,
      timestamp: new Date().toISOString()
    }, {
      status: 200,
      request,
      config,
      noStore: true
    });
  } catch (err) {
    logger.error('health.db_error', { error: err });
    return errorResponse(503, 'DATABASE_UNAVAILABLE', 'ระบบฐานข้อมูลไม่สามารถให้บริการได้ชั่วคราว', {
      request,
      config
    });
  }
}
