/**
 * Environment configuration and URL/Origin allowlist validation.
 * Zero external dependencies — compatible with Cloudflare Workers and Node.js.
 */

function normalizeOrigin(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function normalizeBasePath(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') return '';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '');
}

export function loadConfig(env = {}) {
  const appEnv = String(env.APP_ENV || 'development').trim().toLowerCase();
  const isProduction = appEnv === 'production' || appEnv === 'staging';

  const frontendOrigin = normalizeOrigin(env.FRONTEND_ORIGIN) ||
    (!isProduction ? 'http://localhost:8080' : null);
  const frontendBasePath = normalizeBasePath(env.FRONTEND_BASE_PATH || '');

  const allowedOrigins = new Set();
  if (frontendOrigin) allowedOrigins.add(frontendOrigin);

  const rawAllowed = String(env.ALLOWED_ORIGINS || '');
  for (const part of rawAllowed.split(',')) {
    const norm = normalizeOrigin(part);
    if (norm) allowedOrigins.add(norm);
  }

  const rawSameSite = String(env.COOKIE_SAME_SITE || (isProduction ? 'None' : 'Lax')).trim();
  const sameSiteMap = { lax: 'Lax', strict: 'Strict', none: 'None' };
  const cookieSameSite = sameSiteMap[rawSameSite.toLowerCase()] || 'Lax';

  const parsedSessionTtl = Number.parseInt(String(env.SESSION_TTL_SECONDS || '604800'), 10);
  const sessionTtlSeconds = Number.isFinite(parsedSessionTtl) && parsedSessionTtl >= 300
    ? parsedSessionTtl
    : 604800;

  return {
    appEnv,
    isProduction,
    frontendOrigin,
    frontendBasePath,
    allowedOrigins,
    lineChannelId: env.LINE_CHANNEL_ID ? String(env.LINE_CHANNEL_ID).trim() : '',
    lineChannelSecret: env.LINE_CHANNEL_SECRET ? String(env.LINE_CHANNEL_SECRET).trim() : '',
    lineRedirectUri: env.LINE_REDIRECT_URI ? String(env.LINE_REDIRECT_URI).trim() : '',
    sessionSecret: env.SESSION_SECRET ? String(env.SESSION_SECRET).trim() : '',
    cookieSameSite,
    sessionTtlSeconds,
    oauthStateTtlSeconds: 600,
    policyVersion: String(env.POLICY_VERSION || '2026-01').trim()
  };
}

export function assertLineOAuthConfigured(config) {
  const missing = [];
  if (!config.lineChannelId || config.lineChannelId === 'YOUR_LINE_LOGIN_CHANNEL_ID') {
    missing.push('LINE_CHANNEL_ID');
  }
  if (!config.lineChannelSecret || config.lineChannelSecret === 'YOUR_LINE_LOGIN_CHANNEL_SECRET') {
    missing.push('LINE_CHANNEL_SECRET');
  }
  if (!config.lineRedirectUri) {
    missing.push('LINE_REDIRECT_URI');
  }
  if (!config.sessionSecret || config.sessionSecret.length < 32 || config.sessionSecret.startsWith('REPLACE_WITH_')) {
    missing.push('SESSION_SECRET (>= 32 chars)');
  }
  if (!config.frontendOrigin) {
    missing.push('FRONTEND_ORIGIN');
  }

  if (config.isProduction) {
    try {
      const cb = new URL(config.lineRedirectUri);
      if (cb.protocol !== 'https:') {
        missing.push('LINE_REDIRECT_URI (must use https in production)');
      }
    } catch (_) {
      missing.push('LINE_REDIRECT_URI (invalid URL)');
    }
  } else if (config.lineRedirectUri) {
    try {
      const cb = new URL(config.lineRedirectUri);
      if (cb.protocol !== 'http:' && cb.protocol !== 'https:') {
        missing.push('LINE_REDIRECT_URI (invalid protocol)');
      }
    } catch (_) {
      missing.push('LINE_REDIRECT_URI (invalid URL)');
    }
  }

  return {
    ok: missing.length === 0,
    missing
  };
}

export function assertSessionSecretConfigured(config) {
  return Boolean(
    config.sessionSecret &&
    config.sessionSecret.length >= 32 &&
    !config.sessionSecret.startsWith('REPLACE_WITH_')
  );
}

/**
 * Validates and resolves a post-login frontend redirect target.
 * Strictly blocks open redirects (external hosts, protocol-relative //evil.com, javascript:, backslash tricks).
 */
export function resolveSafeReturnTo(rawReturnTo, config) {
  if (!config.frontendOrigin) {
    return { ok: false, error: 'FRONTEND_ORIGIN_NOT_CONFIGURED' };
  }

  const defaultUrl = `${config.frontendOrigin}${config.frontendBasePath || ''}/`;
  if (rawReturnTo === undefined || rawReturnTo === null || String(rawReturnTo).trim() === '') {
    return { ok: true, url: defaultUrl };
  }

  const candidate = String(rawReturnTo).trim();
  if (candidate.length > 1024 || /[\u0000-\u001F\u007F\\]/.test(candidate)) {
    return { ok: false, error: 'INVALID_RETURN_TO_CHARS' };
  }

  // Case 1: Relative path on the configured frontend origin
  if (candidate.startsWith('/')) {
    if (candidate.startsWith('//')) {
      return { ok: false, error: 'PROTOCOL_RELATIVE_FORBIDDEN' };
    }
    try {
      const resolved = new URL(candidate, config.frontendOrigin);
      if (resolved.origin !== config.frontendOrigin) {
        return { ok: false, error: 'ORIGIN_MISMATCH' };
      }
      if (config.frontendBasePath && !resolved.pathname.startsWith(config.frontendBasePath)) {
        return { ok: false, error: 'OUTSIDE_FRONTEND_BASE_PATH' };
      }
      return { ok: true, url: resolved.toString() };
    } catch (_) {
      return { ok: false, error: 'INVALID_RELATIVE_URL' };
    }
  }

  // Case 2: Full URL — must match strict origin allowlist and http/https scheme
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'UNSAFE_PROTOCOL' };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: 'CREDENTIALS_IN_URL_FORBIDDEN' };
    }
    if (!config.allowedOrigins.has(parsed.origin)) {
      return { ok: false, error: 'UNTRUSTED_ORIGIN' };
    }
    if (
      parsed.origin === config.frontendOrigin &&
      config.frontendBasePath &&
      !parsed.pathname.startsWith(config.frontendBasePath)
    ) {
      return { ok: false, error: 'OUTSIDE_FRONTEND_BASE_PATH' };
    }
    return { ok: true, url: parsed.toString() };
  } catch (_) {
    return { ok: false, error: 'MALFORMED_URL' };
  }
}

export function isAllowedOrigin(originHeader, config) {
  const norm = normalizeOrigin(originHeader);
  if (!norm) return false;
  return config.allowedOrigins.has(norm);
}
