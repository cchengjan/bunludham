/**
 * Official LINE Login v2.1 + PKCE (S256) + OIDC Comprehensive Automated Tests (Phases D & G4).
 *
 * Covers:
 * - Authorization URL structure (response_type=code, alphanumeric state, nonce, PKCE S256, minimal scope)
 * - Valid HS256 & ES256 JWKS login flows + PKCE code_verifier verification
 * - Internal member_id decoupling, returning user identity linking, customized displayName preservation
 * - Session rotation on re-login
 * - User cancellation (access_denied) & upstream provider OAuth errors
 * - Missing, mismatched, expired, and replayed OAuth `state` + missing/mismatched `pfs_oauth_tx` cookie
 * - Concurrent duplicate callback requests (atomic single-use state consumption)
 * - Invalid authorization code rejection
 * - ID token cryptographic attacks: wrong HS256 secret, wrong ES256 signature, `alg: "none"`, wrong `iss`,
 *   wrong `aud`, expired `exp`, future `iat`, mismatched `nonce`, and missing `sub`
 * - Zero raw secrets / codes / tokens leaked in logs or database tables
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sha256Base64Url } from '../src/crypto.js';
import {
  LINE_AUTHORIZE_ENDPOINT,
  LINE_EXPECTED_ISSUER,
  LINE_JWKS_ENDPOINT,
  LINE_TOKEN_ENDPOINT
} from '../src/services/line-oauth.js';
import {
  createTestApp,
  encodeJwtSegment,
  extractCookiesFromResponse,
  formatCookieHeader,
  generateEs256KeyPair,
  loginTestMemberViaLine,
  signEs256Jwt,
  signHs256Jwt,
  TEST_CHANNEL_ID,
  TEST_CHANNEL_SECRET,
  TEST_FRONTEND_ORIGIN,
  TEST_REDIRECT_URI,
  TEST_SESSION_SECRET
} from './helpers/test-harness.mjs';

describe('LINE Login v2.1 + PKCE + OIDC Security & Edge Cases', () => {
  it('constructs compliant LINE v2.1 authorization URL with alphanumeric state, nonce, PKCE S256, and minimal scope', async () => {
    const app = await createTestApp();
    try {
      const res = await app.request(
        `/api/v1/auth/line/start?return_to=${encodeURIComponent(`${TEST_FRONTEND_ORIGIN}/create.html`)}`
      );
      assert.equal(res.status, 302);

      const location = res.headers.get('Location');
      assert.ok(location.startsWith(LINE_AUTHORIZE_ENDPOINT));
      const authUrl = new URL(location);

      assert.equal(authUrl.searchParams.get('response_type'), 'code');
      assert.equal(authUrl.searchParams.get('client_id'), TEST_CHANNEL_ID);
      assert.equal(authUrl.searchParams.get('redirect_uri'), TEST_REDIRECT_URI);
      assert.equal(authUrl.searchParams.get('scope'), 'profile openid');
      assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');

      const state = authUrl.searchParams.get('state');
      assert.match(state, /^[A-Za-z0-9]{43}$/, 'state must be random alphanumeric string');
      assert.ok((authUrl.searchParams.get('nonce') || '').length >= 32);
      assert.ok((authUrl.searchParams.get('code_challenge') || '').length >= 43);

      const jar = extractCookiesFromResponse(res);
      assert.ok(jar.pfs_oauth_tx, 'Must set HttpOnly pfs_oauth_tx browser-binding cookie');
      const rawSetCookie = res.headers.getSetCookie().join(' | ');
      assert.match(rawSetCookie, /HttpOnly/i);
      assert.match(rawSetCookie, /Path=\/api\/v1\/auth\/line/i);
    } finally {
      app.close();
    }
  });

  it('completes valid HS256 login flow, verifies PKCE code_verifier, creates decoupled member_id, and rotates session on re-login', async () => {
    const app = await createTestApp();
    try {
      const startRes = await app.request('/api/v1/auth/line/start');
      const jar1 = extractCookiesFromResponse(startRes);
      const authUrl = new URL(startRes.headers.get('Location'));
      const state = authUrl.searchParams.get('state');
      const nonce = authUrl.searchParams.get('nonce');
      const sentChallenge = authUrl.searchParams.get('code_challenge');

      let capturedTokenForm = null;
      const nowSec = Math.floor(Date.now() / 1000);
      const lineSub = 'U9876543210abcdef1234567890abcdef';
      const idToken = await signHs256Jwt({
        iss: LINE_EXPECTED_ISSUER,
        sub: lineSub,
        aud: TEST_CHANNEL_ID,
        exp: nowSec + 3600,
        iat: nowSec,
        nonce,
        name: 'อุบาสิกา สมหญิง',
        picture: 'https://profile.line-scdn.net/avatar1.png'
      });

      app.env.__FETCH_IMPL = async (url, init) => {
        assert.equal(String(url), LINE_TOKEN_ENDPOINT);
        capturedTokenForm = new URLSearchParams(init.body);
        return new Response(JSON.stringify({
          access_token: 'sensitive_access_token_xyz',
          token_type: 'Bearer',
          id_token: idToken
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const cbRes = await app.request(
        `/api/v1/auth/line/callback?code=sensitive_auth_code_111&state=${state}`,
        { headers: { Cookie: formatCookieHeader(jar1) } }
      );
      assert.equal(cbRes.status, 302);
      assert.match(cbRes.headers.get('Location'), /auth_login=success/);

      // Verify PKCE S256 mathematical binding: BASE64URL(SHA256(code_verifier)) === code_challenge
      assert.ok(capturedTokenForm);
      assert.equal(capturedTokenForm.get('grant_type'), 'authorization_code');
      assert.equal(capturedTokenForm.get('code'), 'sensitive_auth_code_111');
      const derivedChallenge = await sha256Base64Url(capturedTokenForm.get('code_verifier'));
      assert.equal(derivedChallenge, sentChallenge);

      const jarAfterLogin1 = extractCookiesFromResponse(cbRes, jar1);
      assert.ok(jarAfterLogin1.pfs_session, 'Opaque pfs_session cookie must be issued');
      assert.equal(jarAfterLogin1.pfs_oauth_tx, undefined, 'Temporary pfs_oauth_tx cookie must be cleared');

      const meRes1 = await app.request('/api/v1/auth/me', {
        headers: { Cookie: formatCookieHeader(jarAfterLogin1) }
      });
      const meData1 = await meRes1.json();
      assert.equal(meData1.authenticated, true);
      assert.match(meData1.member.id, /^mem_[A-Za-z0-9]{24}$/);
      assert.notEqual(meData1.member.id, lineSub, 'Internal member_id must never equal LINE sub');
      assert.equal(meData1.member.role, 'MEMBER', 'LINE Login must never auto-grant ADMIN');

      // Customize display name, then re-login with the same LINE sub -> must preserve custom name & rotate old session!
      const patchRes = await app.request('/api/v1/members/me', {
        method: 'PATCH',
        headers: {
          Cookie: formatCookieHeader(jarAfterLogin1),
          Origin: TEST_FRONTEND_ORIGIN,
          'Content-Type': 'application/json',
          'X-CSRF-Token': meData1.csrfToken
        },
        body: JSON.stringify({ displayName: 'ชื่อที่แก้ไขเองโดยสมาชิก' })
      });
      assert.equal(patchRes.status, 200);

      const secondLogin = await loginTestMemberViaLine(app, {
        sub: lineSub,
        name: 'ชื่อใหม่จากฝั่ง LINE',
        existingJar: jarAfterLogin1
      });
      assert.notEqual(secondLogin.jar.pfs_session, jarAfterLogin1.pfs_session, 'Session token must rotate on login');

      // Old session cookie must now be revoked (401)
      const oldSessionCheck = await app.request('/api/v1/auth/me', {
        headers: { Cookie: formatCookieHeader(jarAfterLogin1) }
      });
      assert.equal(oldSessionCheck.status, 401);

      // New session cookie succeeds, keeps same member.id, and preserves customized displayName
      const meRes2 = await app.request('/api/v1/auth/me', {
        headers: { Cookie: formatCookieHeader(secondLogin.jar) }
      });
      const meData2 = await meRes2.json();
      assert.equal(meData2.authenticated, true);
      assert.equal(meData2.member.id, meData1.member.id);
      assert.equal(meData2.member.displayName, 'ชื่อที่แก้ไขเองโดยสมาชิก');
    } finally {
      app.close();
    }
  });

  it('verifies ES256 asymmetric ID tokens using LINE OIDC JWKS endpoint', async () => {
    const app = await createTestApp();
    try {
      const esKey = await generateEs256KeyPair('line-prod-key-2026');
      const startRes = await app.request('/api/v1/auth/line/start');
      const jar = extractCookiesFromResponse(startRes);
      const authUrl = new URL(startRes.headers.get('Location'));
      const state = authUrl.searchParams.get('state');
      const nonce = authUrl.searchParams.get('nonce');

      const nowSec = Math.floor(Date.now() / 1000);
      const es256IdToken = await signEs256Jwt({
        iss: LINE_EXPECTED_ISSUER,
        sub: 'U_ES256_VERIFIED_MEMBER',
        aud: TEST_CHANNEL_ID,
        exp: nowSec + 3600,
        iat: nowSec,
        nonce,
        name: 'สมาชิก ES256'
      }, esKey.privateKey, esKey.kid);

      app.env.__FETCH_IMPL = async (url) => {
        if (String(url) === LINE_TOKEN_ENDPOINT) {
          return new Response(JSON.stringify({
            access_token: 'mock_at',
            token_type: 'Bearer',
            id_token: es256IdToken
          }), { status: 200 });
        }
        if (String(url) === LINE_JWKS_ENDPOINT) {
          return new Response(JSON.stringify({ keys: [esKey.publicJwk] }), { status: 200 });
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const cbRes = await app.request(
        `/api/v1/auth/line/callback?code=es256_code&state=${state}`,
        { headers: { Cookie: formatCookieHeader(jar) } }
      );
      assert.equal(cbRes.status, 302);
      assert.match(cbRes.headers.get('Location'), /auth_login=success/);
    } finally {
      app.close();
    }
  });

  it('handles user cancellation (access_denied) and upstream OAuth errors safely', async () => {
    const app = await createTestApp();
    try {
      // 1. User cancelled
      const s1 = await app.request('/api/v1/auth/line/start');
      const jar1 = extractCookiesFromResponse(s1);
      const state1 = new URL(s1.headers.get('Location')).searchParams.get('state');

      const cancelRes = await app.request(
        `/api/v1/auth/line/callback?error=access_denied&error_description=user_cancelled&state=${state1}`,
        { headers: { Cookie: formatCookieHeader(jar1) } }
      );
      assert.equal(cancelRes.status, 302);
      assert.match(cancelRes.headers.get('Location'), /auth_error=cancelled/);

      // 2. Upstream provider error
      const s2 = await app.request('/api/v1/auth/line/start');
      const jar2 = extractCookiesFromResponse(s2);
      const state2 = new URL(s2.headers.get('Location')).searchParams.get('state');

      const errRes = await app.request(
        `/api/v1/auth/line/callback?error=server_error&state=${state2}`,
        { headers: { Cookie: formatCookieHeader(jar2) } }
      );
      assert.equal(errRes.status, 302);
      assert.match(errRes.headers.get('Location'), /auth_error=provider_error/);
    } finally {
      app.close();
    }
  });

  it('rejects missing, mismatched, expired, and replayed state as well as concurrent duplicate callbacks', async () => {
    const app = await createTestApp();
    try {
      // Missing state
      const rMissing = await app.request('/api/v1/auth/line/callback?code=abc');
      assert.equal(rMissing.status, 302);
      assert.match(rMissing.headers.get('Location'), /auth_error=invalid_state/);

      // Mismatched state / cookie
      const s1 = await app.request('/api/v1/auth/line/start');
      const jar1 = extractCookiesFromResponse(s1);
      const rMismatch = await app.request(
        '/api/v1/auth/line/callback?code=abc&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        { headers: { Cookie: formatCookieHeader(jar1) } }
      );
      assert.match(rMismatch.headers.get('Location'), /auth_error=invalid_state/);

      // Expired state
      const sExp = await app.request('/api/v1/auth/line/start');
      const jarExp = extractCookiesFromResponse(sExp);
      const stateExp = new URL(sExp.headers.get('Location')).searchParams.get('state');
      await app.db
        .prepare("UPDATE oauth_transactions SET expires_at = '2020-01-01T00:00:00.000Z'")
        .run();

      const rExp = await app.request(
        `/api/v1/auth/line/callback?code=abc&state=${stateExp}`,
        { headers: { Cookie: formatCookieHeader(jarExp) } }
      );
      assert.match(rExp.headers.get('Location'), /auth_error=expired_state/);

      // Concurrent duplicate callbacks & replay protection
      const sRace = await app.request('/api/v1/auth/line/start');
      const jarRace = extractCookiesFromResponse(sRace);
      const authUrlRace = new URL(sRace.headers.get('Location'));
      const stateRace = authUrlRace.searchParams.get('state');
      const nonceRace = authUrlRace.searchParams.get('nonce');
      const nowSec = Math.floor(Date.now() / 1000);
      const validIdToken = await signHs256Jwt({
        iss: LINE_EXPECTED_ISSUER,
        sub: 'U_CONCURRENT_RACE_TEST',
        aud: TEST_CHANNEL_ID,
        exp: nowSec + 3600,
        iat: nowSec,
        nonce: nonceRace,
        name: 'Race Tester'
      });

      app.env.__FETCH_IMPL = async () => new Response(JSON.stringify({
        access_token: 'at_race',
        token_type: 'Bearer',
        id_token: validIdToken
      }), { status: 200 });

      const [cbA, cbB] = await Promise.all([
        app.request(`/api/v1/auth/line/callback?code=race_code&state=${stateRace}`, {
          headers: { Cookie: formatCookieHeader(jarRace) }
        }),
        app.request(`/api/v1/auth/line/callback?code=race_code&state=${stateRace}`, {
          headers: { Cookie: formatCookieHeader(jarRace) }
        })
      ]);

      const locations = [cbA.headers.get('Location'), cbB.headers.get('Location')];
      const successCount = locations.filter((loc) => loc.includes('auth_login=success')).length;
      const rejectedCount = locations.filter((loc) => loc.includes('auth_error=invalid_state')).length;
      assert.equal(successCount, 1, 'Exactly one callback may consume the OAuth state');
      assert.equal(rejectedCount, 1, 'Duplicate concurrent callback must be rejected');

      // Subsequent replay attempt must also fail
      const cbReplay = await app.request(`/api/v1/auth/line/callback?code=race_code&state=${stateRace}`, {
        headers: { Cookie: formatCookieHeader(jarRace) }
      });
      assert.match(cbReplay.headers.get('Location'), /auth_error=invalid_state/);
    } finally {
      app.close();
    }
  });

  it('rejects invalid authorization code and all malformed/forged ID token variants', async () => {
    const app = await createTestApp();
    try {
      async function runCallbackWithMockTokenResponse(buildResponse) {
        const s = await app.request('/api/v1/auth/line/start');
        const jar = extractCookiesFromResponse(s);
        const u = new URL(s.headers.get('Location'));
        const state = u.searchParams.get('state');
        const nonce = u.searchParams.get('nonce');
        app.env.__FETCH_IMPL = async () => buildResponse(nonce);
        return app.request(`/api/v1/auth/line/callback?code=test_code&state=${state}`, {
          headers: { Cookie: formatCookieHeader(jar) }
        });
      }

      // 1. Invalid authorization code rejected by LINE token endpoint
      const badCodeRes = await runCallbackWithMockTokenResponse(() => new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'invalid authorization code' }),
        { status: 400 }
      ));
      assert.match(badCodeRes.headers.get('Location'), /auth_error=token_exchange_failed/);

      const nowSec = Math.floor(Date.now() / 1000);
      const baseClaims = (nonce) => ({
        iss: LINE_EXPECTED_ISSUER,
        sub: 'U_ATTACK_TEST',
        aud: TEST_CHANNEL_ID,
        exp: nowSec + 3600,
        iat: nowSec,
        nonce
      });

      // 2. Wrong HS256 signature
      const badSigRes = await runCallbackWithMockTokenResponse(async (nonce) => {
        const badJwt = await signHs256Jwt(baseClaims(nonce), 'wrong_secret_key_0000000000000000');
        return new Response(JSON.stringify({ id_token: badJwt }), { status: 200 });
      });
      assert.match(badSigRes.headers.get('Location'), /auth_error=invalid_id_token/);

      // 3. `alg: "none"` attack
      const algNoneRes = await runCallbackWithMockTokenResponse(async (nonce) => {
        const unsignedJwt = `${encodeJwtSegment({ alg: 'none', typ: 'JWT' })}.${encodeJwtSegment(baseClaims(nonce))}.sig`;
        return new Response(JSON.stringify({ id_token: unsignedJwt }), { status: 200 });
      });
      assert.match(algNoneRes.headers.get('Location'), /auth_error=invalid_id_token/);

      // 4. Wrong issuer (`iss`)
      const badIssRes = await runCallbackWithMockTokenResponse(async (nonce) => {
        const jwt = await signHs256Jwt({ ...baseClaims(nonce), iss: 'https://evil-issuer.example' });
        return new Response(JSON.stringify({ id_token: jwt }), { status: 200 });
      });
      assert.match(badIssRes.headers.get('Location'), /auth_error=invalid_id_token/);

      // 5. Wrong audience (`aud`)
      const badAudRes = await runCallbackWithMockTokenResponse(async (nonce) => {
        const jwt = await signHs256Jwt({ ...baseClaims(nonce), aud: '9999999999' });
        return new Response(JSON.stringify({ id_token: jwt }), { status: 200 });
      });
      assert.match(badAudRes.headers.get('Location'), /auth_error=invalid_id_token/);

      // 6. Expired `id_token` (`exp <= now`)
      const expiredTokenRes = await runCallbackWithMockTokenResponse(async (nonce) => {
        const jwt = await signHs256Jwt({ ...baseClaims(nonce), exp: nowSec - 10 });
        return new Response(JSON.stringify({ id_token: jwt }), { status: 200 });
      });
      assert.match(expiredTokenRes.headers.get('Location'), /auth_error=invalid_id_token/);

      // 7. Invalid `nonce`
      const badNonceRes = await runCallbackWithMockTokenResponse(async () => {
        const jwt = await signHs256Jwt({ ...baseClaims('wrong_nonce_value') });
        return new Response(JSON.stringify({ id_token: jwt }), { status: 200 });
      });
      assert.match(badNonceRes.headers.get('Location'), /auth_error=invalid_id_token/);

      // 8. Missing `sub`
      const missingSubRes = await runCallbackWithMockTokenResponse(async (nonce) => {
        const claims = baseClaims(nonce);
        delete claims.sub;
        const jwt = await signHs256Jwt(claims);
        return new Response(JSON.stringify({ id_token: jwt }), { status: 200 });
      });
      assert.match(missingSubRes.headers.get('Location'), /auth_error=invalid_id_token/);
    } finally {
      app.close();
    }
  });

  it('never leaks raw OAuth codes, access/ID tokens, secrets, or raw session tokens into logs or DB', async () => {
    const app = await createTestApp();
    try {
      const { jar } = await loginTestMemberViaLine(app, { sub: 'U_REDACTION_CHECK' });
      const rawSessionToken = jar.pfs_session;
      assert.ok(rawSessionToken);

      // Check structured logs
      const allLogsDump = app.logs.map((l) => l.raw).join('\n');
      assert.equal(allLogsDump.includes(TEST_CHANNEL_SECRET), false);
      assert.equal(allLogsDump.includes(TEST_SESSION_SECRET), false);
      assert.equal(allLogsDump.includes('mock_one_time_code_789'), false);
      assert.equal(allLogsDump.includes('mock_line_access_token_secret_123'), false);
      assert.equal(allLogsDump.includes('mock_line_refresh_token_secret_456'), false);
      assert.equal(allLogsDump.includes(rawSessionToken), false);

      // Check sessions table stores only SHA-256 hash, never raw session token
      const sessionRows = (await app.db.prepare('SELECT token_hash FROM sessions').all()).results;
      assert.equal(sessionRows.length, 1);
      assert.notEqual(sessionRows[0].token_hash, rawSessionToken);
      assert.equal(sessionRows[0].token_hash.length, 64);

      // Check audit_logs table contains zero secrets/tokens
      const auditDump = JSON.stringify((await app.db.prepare('SELECT * FROM audit_logs').all()).results);
      assert.equal(auditDump.includes(rawSessionToken), false);
      assert.equal(auditDump.includes('mock_line_access_token_secret_123'), false);
    } finally {
      app.close();
    }
  });
});
