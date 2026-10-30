/**
 * Shared Test Harness for Backend API, Mocked LINE OAuth/OIDC, and Cookie Jar Simulation.
 */

import worker from '../../src/index.js';
import {
  randomAlphanumeric,
  uint8ArrayToBase64Url
} from '../../src/crypto.js';
import { createSqliteD1Adapter } from '../../src/db/d1-sqlite-adapter.js';
import { runMigrations } from '../../src/db/migrator.js';
import {
  clearLineJwksCacheForTests,
  LINE_EXPECTED_ISSUER,
  LINE_JWKS_ENDPOINT,
  LINE_TOKEN_ENDPOINT
} from '../../src/services/line-oauth.js';

const encoder = new TextEncoder();

export const TEST_CHANNEL_ID = '2009998887';
export const TEST_CHANNEL_SECRET = 'test_line_channel_secret_32_bytes_minimum_xyz';
export const TEST_SESSION_SECRET = 'test_session_secret_at_least_32_random_chars_987654321';
export const TEST_FRONTEND_ORIGIN = 'http://localhost:8080';
export const TEST_API_ORIGIN = 'http://localhost:8787';
export const TEST_REDIRECT_URI = `${TEST_API_ORIGIN}/api/v1/auth/line/callback`;

export function encodeJwtSegment(obj) {
  return uint8ArrayToBase64Url(encoder.encode(JSON.stringify(obj)));
}

export async function signHs256Jwt(payload, secret = TEST_CHANNEL_SECRET, headerExtra = {}) {
  const header = { alg: 'HS256', typ: 'JWT', ...headerExtra };
  const hB64 = encodeJwtSegment(header);
  const pB64 = encodeJwtSegment(payload);
  const signingInput = encoder.encode(`${hB64}.${pB64}`);

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, signingInput);
  return `${hB64}.${pB64}.${uint8ArrayToBase64Url(new Uint8Array(sig))}`;
}

export async function generateEs256KeyPair(kid = 'line-es256-key-1') {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    kid,
    privateKey: keyPair.privateKey,
    publicJwk: {
      ...publicJwk,
      kid,
      use: 'sig',
      alg: 'ES256'
    }
  };
}

export async function signEs256Jwt(payload, privateKey, kid = 'line-es256-key-1') {
  const header = { alg: 'ES256', typ: 'JWT', kid };
  const hB64 = encodeJwtSegment(header);
  const pB64 = encodeJwtSegment(payload);
  const signingInput = encoder.encode(`${hB64}.${pB64}`);

  const sig = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signingInput
  );
  return `${hB64}.${pB64}.${uint8ArrayToBase64Url(new Uint8Array(sig))}`;
}

export async function createTestApp(envOverrides = {}) {
  clearLineJwksCacheForTests();
  const db = createSqliteD1Adapter(':memory:');
  await runMigrations(db);

  const logs = [];
  const env = {
    APP_ENV: 'development',
    FRONTEND_ORIGIN: TEST_FRONTEND_ORIGIN,
    ALLOWED_ORIGINS: `${TEST_FRONTEND_ORIGIN},http://127.0.0.1:8080`,
    LINE_CHANNEL_ID: TEST_CHANNEL_ID,
    LINE_CHANNEL_SECRET: TEST_CHANNEL_SECRET,
    LINE_REDIRECT_URI: TEST_REDIRECT_URI,
    SESSION_SECRET: TEST_SESSION_SECRET,
    COOKIE_SAME_SITE: 'Lax',
    SESSION_TTL_SECONDS: '604800',
    POLICY_VERSION: '2026-01',
    DB: db,
    __LOG_SINK: (entry, raw) => logs.push({ entry, raw }),
    ...envOverrides
  };

  async function request(pathOrUrl, init = {}) {
    const fullUrl = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${TEST_API_ORIGIN}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
    const req = new Request(fullUrl, init);
    return worker.fetch(req, env, {});
  }

  return {
    db,
    env,
    logs,
    request,
    close() {
      db.close();
    }
  };
}

export function extractCookiesFromResponse(response, existingJar = {}) {
  const jar = { ...existingJar };
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);

  for (const headerVal of setCookies) {
    const firstPart = headerVal.split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const val = decodeURIComponent(firstPart.slice(eqIdx + 1).trim());
    const isMaxAgeZero = /Max-Age=0/i.test(headerVal);
    if (isMaxAgeZero || val === '') {
      delete jar[name];
    } else {
      jar[name] = val;
    }
  }
  return jar;
}

export function formatCookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
}

/**
 * Performs a complete mocked LINE Login v2.1 flow for a test user and returns `{ jar, state, memberSub }`.
 */
export async function loginTestMemberViaLine(app, {
  sub = `U_${randomAlphanumeric(20)}`,
  name = 'กิตติคุณ สาธุชน',
  picture = 'https://profile.line-scdn.net/mock-avatar.png',
  existingJar = {}
} = {}) {
  const startRes = await app.request(
    `/api/v1/auth/line/start?return_to=${encodeURIComponent(`${TEST_FRONTEND_ORIGIN}/index.html`)}`
  );
  if (startRes.status !== 302) {
    throw new Error(`Expected 302 from /auth/line/start, got ${startRes.status}`);
  }
  let jar = extractCookiesFromResponse(startRes, existingJar);
  const authRedirect = new URL(startRes.headers.get('Location'));
  const state = authRedirect.searchParams.get('state');
  const nonce = authRedirect.searchParams.get('nonce');

  const nowSec = Math.floor(Date.now() / 1000);
  const idToken = await signHs256Jwt({
    iss: LINE_EXPECTED_ISSUER,
    sub,
    aud: TEST_CHANNEL_ID,
    exp: nowSec + 3600,
    iat: nowSec,
    nonce,
    name,
    picture,
    amr: ['linesso']
  });

  const prevFetch = app.env.__FETCH_IMPL;
  app.env.__FETCH_IMPL = async (url) => {
    if (String(url) === LINE_TOKEN_ENDPOINT) {
      return new Response(JSON.stringify({
        access_token: 'mock_line_access_token_secret_123',
        token_type: 'Bearer',
        refresh_token: 'mock_line_refresh_token_secret_456',
        expires_in: 2592000,
        scope: 'profile openid',
        id_token: idToken
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url) === LINE_JWKS_ENDPOINT) {
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }
    throw new Error(`Unexpected outbound fetch in test: ${url}`);
  };

  try {
    const cbRes = await app.request(
      `/api/v1/auth/line/callback?code=mock_one_time_code_789&state=${encodeURIComponent(state)}`,
      {
        headers: {
          Cookie: formatCookieHeader(jar)
        }
      }
    );
    jar = extractCookiesFromResponse(cbRes, jar);
    return { jar, callbackResponse: cbRes, sub };
  } finally {
    app.env.__FETCH_IMPL = prevFetch;
  }
}
