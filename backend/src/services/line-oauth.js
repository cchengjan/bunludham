/**
 * Official LINE Login v2.1 + PKCE (S256) + OpenID Connect Integration Service.
 *
 * Implements:
 * - Authorization URL construction (`https://access.line.me/oauth2/v2.1/authorize`)
 * - Server-side authorization code + PKCE `code_verifier` token exchange (`POST https://api.line.me/oauth2/v2.1/token`)
 * - Cryptographic ID token verification (`HS256` with Channel Secret and `ES256` with LINE OIDC JWKS `https://api.line.me/oauth2/v2.1/certs`)
 * - Full OIDC claims validation (`iss`, `aud`, `sub`, `exp`, `iat`, `nonce`)
 */

import {
  sha256Base64Url,
  timingSafeEqualStr,
  verifyJwtSignatureAndDecode
} from '../crypto.js';

export const LINE_AUTHORIZE_ENDPOINT = 'https://access.line.me/oauth2/v2.1/authorize';
export const LINE_TOKEN_ENDPOINT = 'https://api.line.me/oauth2/v2.1/token';
export const LINE_JWKS_ENDPOINT = 'https://api.line.me/oauth2/v2.1/certs';
export const LINE_EXPECTED_ISSUER = 'https://access.line.me';

// Short-lived in-memory JWKS cache for ES256 public keys
let jwksCache = {
  keys: [],
  fetchedAtMs: 0
};
const JWKS_CACHE_TTL_MS = 15 * 60 * 1000;

export function clearLineJwksCacheForTests() {
  jwksCache = { keys: [], fetchedAtMs: 0 };
}

/**
 * Builds the official LINE Login v2.1 authorization URL with PKCE S256 and OIDC nonce.
 * Uses minimal scope (`profile openid`) so email permission is not unnecessarily requested.
 */
export async function buildLineAuthorizeUrl({
  channelId,
  redirectUri,
  state,
  nonce,
  codeVerifier,
  scope = 'profile openid'
}) {
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const url = new URL(LINE_AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', channelId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scope);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * Exchanges a one-time LINE authorization code + PKCE code_verifier for tokens on the server.
 */
export async function exchangeLineAuthorizationCode({
  code,
  codeVerifier,
  channelId,
  channelSecret,
  redirectUri,
  fetchImpl = globalThis.fetch
}) {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);
  body.set('client_id', channelId);
  body.set('client_secret', channelSecret);
  body.set('code_verifier', codeVerifier);

  let response;
  try {
    response = await fetchImpl(LINE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: body.toString()
    });
  } catch (err) {
    const error = new Error('LINE_TOKEN_NETWORK_ERROR');
    error.code = 'LINE_TOKEN_NETWORK_ERROR';
    throw error;
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    const error = new Error('LINE_TOKEN_MALFORMED_RESPONSE');
    error.code = 'LINE_TOKEN_MALFORMED_RESPONSE';
    throw error;
  }

  if (!response.ok || !data || typeof data !== 'object') {
    const error = new Error('LINE_TOKEN_EXCHANGE_FAILED');
    error.code = 'LINE_TOKEN_EXCHANGE_FAILED';
    error.upstreamStatus = response.status;
    error.upstreamError = data && typeof data.error === 'string' ? data.error : 'unknown_error';
    throw error;
  }

  if (typeof data.id_token !== 'string' || !data.id_token) {
    const error = new Error('LINE_ID_TOKEN_MISSING');
    error.code = 'LINE_ID_TOKEN_MISSING';
    throw error;
  }

  return {
    idToken: data.id_token,
    scope: typeof data.scope === 'string' ? data.scope : '',
    tokenType: typeof data.token_type === 'string' ? data.token_type : ''
  };
}

async function resolveLineJwkByKid(kid, fetchImpl = globalThis.fetch) {
  const nowMs = Date.now();
  const findKey = () => jwksCache.keys.find(k => k && k.kid === kid) || null;

  if (jwksCache.keys.length > 0 && nowMs - jwksCache.fetchedAtMs < JWKS_CACHE_TTL_MS) {
    const cached = findKey();
    if (cached) return cached;
  }

  const res = await fetchImpl(LINE_JWKS_ENDPOINT, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) {
    throw new Error(`LINE_JWKS_FETCH_FAILED:${res.status}`);
  }
  const parsed = await res.json();
  if (!parsed || !Array.isArray(parsed.keys)) {
    throw new Error('LINE_JWKS_INVALID_PAYLOAD');
  }
  jwksCache = {
    keys: parsed.keys,
    fetchedAtMs: nowMs
  };
  return findKey();
}

/**
 * Cryptographically verifies a LINE OpenID Connect ID Token (`HS256` or `ES256`)
 * and validates all required OIDC claims (`iss`, `aud`, `sub`, `exp`, `iat`, `nonce`).
 */
export async function verifyLineIdToken({
  idToken,
  channelId,
  channelSecret,
  expectedNonce,
  nowSec = Math.floor(Date.now() / 1000),
  fetchImpl = globalThis.fetch
}) {
  const { header, payload } = await verifyJwtSignatureAndDecode(idToken, {
    allowedAlgs: ['HS256', 'ES256'],
    channelSecret,
    getJwkByKid: (kid) => resolveLineJwkByKid(kid, fetchImpl)
  });

  if (payload.iss !== LINE_EXPECTED_ISSUER) {
    const err = new Error('ID_TOKEN_INVALID_ISSUER');
    err.code = 'ID_TOKEN_INVALID_ISSUER';
    throw err;
  }

  const audMatch = Array.isArray(payload.aud)
    ? payload.aud.includes(channelId)
    : payload.aud === channelId;
  if (!audMatch) {
    const err = new Error('ID_TOKEN_INVALID_AUDIENCE');
    err.code = 'ID_TOKEN_INVALID_AUDIENCE';
    throw err;
  }

  if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0 || payload.sub.length > 128) {
    const err = new Error('ID_TOKEN_INVALID_SUBJECT');
    err.code = 'ID_TOKEN_INVALID_SUBJECT';
    throw err;
  }

  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
    const err = new Error('ID_TOKEN_EXPIRED');
    err.code = 'ID_TOKEN_EXPIRED';
    throw err;
  }

  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > nowSec + 60) {
    const err = new Error('ID_TOKEN_INVALID_IAT');
    err.code = 'ID_TOKEN_INVALID_IAT';
    throw err;
  }

  if (
    !expectedNonce ||
    typeof payload.nonce !== 'string' ||
    !timingSafeEqualStr(payload.nonce, expectedNonce)
  ) {
    const err = new Error('ID_TOKEN_INVALID_NONCE');
    err.code = 'ID_TOKEN_INVALID_NONCE';
    throw err;
  }

  // Sanitize optional profile fields from verified ID token claims
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const displayName = (rawName || 'สมาชิกบุญลือธรรม').slice(0, 80);

  let pictureUrl = null;
  if (typeof payload.picture === 'string' && payload.picture.trim()) {
    try {
      const pic = new URL(payload.picture.trim());
      if (pic.protocol === 'https:') {
        pictureUrl = pic.toString();
      }
    } catch (_) {
      pictureUrl = null;
    }
  }

  const amr = Array.isArray(payload.amr)
    ? payload.amr.filter(x => typeof x === 'string').slice(0, 10)
    : [];

  return {
    alg: header.alg,
    subject: payload.sub.trim(),
    displayName,
    pictureUrl,
    amr
  };
}
