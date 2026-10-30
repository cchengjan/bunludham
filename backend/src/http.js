/**
 * HTTP response builders, security headers, and strict CORS handling.
 */

import { isAllowedOrigin } from './config.js';

export function buildSecurityHeaders({ noStore = true } = {}) {
  const headers = new Headers();
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (noStore) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    headers.set('Pragma', 'no-cache');
  }
  return headers;
}

export function applyCorsHeaders(headers, request, config) {
  const origin = request.headers.get('Origin');
  headers.set('Vary', 'Origin');
  if (origin && isAllowedOrigin(origin, config)) {
    headers.set('Access-Control-Allow-Origin', new URL(origin).origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

export function handleCorsPreflight(request, config) {
  const origin = request.headers.get('Origin');
  const headers = buildSecurityHeaders({ noStore: true });
  headers.set('Vary', 'Origin');

  if (!origin || !isAllowedOrigin(origin, config)) {
    return new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'CORS_ORIGIN_FORBIDDEN',
        message: 'ไม่อนุญาตการเชื่อมต่อจากต้นทางนี้'
      }
    }), {
      status: 403,
      headers: {
        ...Object.fromEntries(headers.entries()),
        'Content-Type': 'application/json; charset=utf-8'
      }
    });
  }

  headers.set('Access-Control-Allow-Origin', new URL(origin).origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Accept');
  headers.set('Access-Control-Max-Age', '600');

  return new Response(null, { status: 204, headers });
}

export function jsonResponse(body, {
  status = 200,
  request,
  config,
  noStore = true,
  setCookies = [],
  extraHeaders = {}
} = {}) {
  const headers = buildSecurityHeaders({ noStore });
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (request && config) {
    applyCorsHeaders(headers, request, config);
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, v);
  }
  for (const cookieStr of setCookies) {
    if (cookieStr) headers.append('Set-Cookie', cookieStr);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(status, code, message, {
  request,
  config,
  details,
  setCookies = [],
  extraHeaders = {}
} = {}) {
  const errorObj = { code, message };
  if (details !== undefined) errorObj.details = details;
  return jsonResponse({ ok: false, error: errorObj }, {
    status,
    request,
    config,
    noStore: true,
    setCookies,
    extraHeaders
  });
}

export function redirectResponse(locationUrl, {
  status = 302,
  setCookies = []
} = {}) {
  const headers = buildSecurityHeaders({ noStore: true });
  headers.set('Location', locationUrl);
  for (const cookieStr of setCookies) {
    if (cookieStr) headers.append('Set-Cookie', cookieStr);
  }
  return new Response(null, { status, headers });
}

export async function parseJsonBody(request, { maxBytes = 16384 } = {}) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {
      ok: false,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'กรุณาส่งข้อมูลในรูปแบบ application/json'
    };
  }

  let rawText;
  try {
    rawText = await request.text();
  } catch (_) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_BODY',
      message: 'ไม่สามารถอ่านข้อมูลคำขอได้'
    };
  }

  if (new TextEncoder().encode(rawText).byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'ขนาดข้อมูลเกินขีดจำกัดที่อนุญาต'
    };
  }

  if (!rawText.trim()) {
    return { ok: true, data: {} };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_JSON_OBJECT',
        message: 'รูปแบบ JSON ต้องเป็นออบเจ็กต์ (Object)'
      };
    }
    return { ok: true, data: parsed };
  } catch (_) {
    return {
      ok: false,
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'รูปแบบ JSON ไม่ถูกต้อง'
    };
  }
}

export function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return '127.0.0.1';
}

export function summarizeUserAgent(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!ua) return null;
  return ua.slice(0, 160);
}
