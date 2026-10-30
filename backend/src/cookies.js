/**
 * Strict HTTP cookie parsing and Set-Cookie serialization.
 * Enforces HttpOnly, narrow Path, host-only scope, Secure in production/HTTPS, and explicit SameSite.
 */

export const SESSION_COOKIE_NAME = 'pfs_session';
export const OAUTH_TX_COOKIE_NAME = 'pfs_oauth_tx';

export function parseCookies(cookieHeader) {
  const result = Object.create(null);
  if (!cookieHeader || typeof cookieHeader !== 'string') return result;

  const pairs = cookieHeader.split(';');
  for (const part of pairs) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const rawName = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!rawName) continue;
    try {
      result[rawName] = decodeURIComponent(rawVal);
    } catch (_) {
      result[rawName] = rawVal;
    }
  }
  return result;
}

export function isSecureRequest(request, config) {
  if (config && config.isProduction) return true;
  if (config && config.cookieSameSite === 'None') return true;
  try {
    const url = new URL(request.url);
    if (url.protocol === 'https:') return true;
  } catch (_) {}
  const forwardedProto = request.headers.get('x-forwarded-proto');
  return Boolean(forwardedProto && forwardedProto.toLowerCase().includes('https'));
}

export function serializeCookie(name, value, {
  maxAge,
  path = '/api/v1',
  httpOnly = true,
  secure = true,
  sameSite = 'Lax',
  partitioned = false
} = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`INVALID_COOKIE_NAME:${name}`);
  }
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (path) segments.push(`Path=${path}`);
  if (typeof maxAge === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
    if (maxAge <= 0) {
      segments.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    }
  }
  if (httpOnly) segments.push('HttpOnly');
  if (secure) segments.push('Secure');
  if (sameSite) segments.push(`SameSite=${sameSite}`);
  if (partitioned && secure && sameSite === 'None') {
    segments.push('Partitioned');
  }
  return segments.join('; ');
}

export function buildSessionSetCookie(token, request, config) {
  const secure = isSecureRequest(request, config);
  const sameSite = config.cookieSameSite === 'None' && !secure ? 'Lax' : config.cookieSameSite;
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: config.sessionTtlSeconds,
    path: '/api/v1',
    httpOnly: true,
    secure,
    sameSite,
    partitioned: sameSite === 'None' && secure
  });
}

export function buildClearSessionCookie(request, config) {
  const secure = isSecureRequest(request, config);
  const sameSite = config.cookieSameSite === 'None' && !secure ? 'Lax' : config.cookieSameSite;
  return serializeCookie(SESSION_COOKIE_NAME, '', {
    maxAge: 0,
    path: '/api/v1',
    httpOnly: true,
    secure,
    sameSite,
    partitioned: sameSite === 'None' && secure
  });
}

export function buildOAuthTxSetCookie(txToken, request, config) {
  const secure = isSecureRequest(request, config);
  // Top-level OAuth redirect always sends SameSite=Lax cookies safely across redirect back from LINE
  return serializeCookie(OAUTH_TX_COOKIE_NAME, txToken, {
    maxAge: config.oauthStateTtlSeconds,
    path: '/api/v1/auth/line',
    httpOnly: true,
    secure,
    sameSite: 'Lax'
  });
}

export function buildClearOAuthTxCookie(request, config) {
  const secure = isSecureRequest(request, config);
  return serializeCookie(OAUTH_TX_COOKIE_NAME, '', {
    maxAge: 0,
    path: '/api/v1/auth/line',
    httpOnly: true,
    secure,
    sameSite: 'Lax'
  });
}
