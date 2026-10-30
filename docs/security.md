# Security Architecture & Threat Controls

This document summarizes the security design, cryptographic controls, and abuse mitigations implemented for the Bunludham LINE Login v2.1 Membership System and static frontend.

---

## 1. Security Design Principles

1. **Zero Secrets in Frontend**: [`config.js`](../config.js), [`shared/api-client.js`](../shared/api-client.js), and [`shared/member-auth.js`](../shared/member-auth.js) contain only public configuration (API base URL and UI toggles). `LINE_CHANNEL_SECRET` and `SESSION_SECRET` exist exclusively in server-side Worker secrets / local `.dev.vars` (gitignored).
2. **Zero Auth Tokens in Web Storage**: LINE `access_token`, `id_token`, `refresh_token`, and session identifiers are **never** returned in JSON bodies, URL fragments, or `LocalStorage` / `SessionStorage`.
3. **Opaque Server-Validated Sessions**: Browser authentication uses a single opaque `HttpOnly` cookie (`pfs_session`), while only `SHA-256(session_token)` is stored in SQLite/D1 (`sessions.token_hash`).
4. **Decoupled Internal Identity**: Application tables reference internal random IDs (`mem_...`), never exposing raw LINE `sub` identifiers as public keys or trusting client-supplied IDs.
5. **Strict Separation of Client UI PIN vs Server RBAC**: Any client-side `admin.html` PIN check is treated strictly as a local UI convenience lock for offline `LocalStorage` editing. Server endpoints (`/api/v1/admin/*`) enforce `members.role === 'ADMIN'` from the server-validated database session. Logging in with LINE grants `MEMBER` role only—never `ADMIN`.

---

## 2. LINE Login v2.1 & OpenID Connect Controls

Implemented in [`backend/src/services/line-oauth.js`](../backend/src/services/line-oauth.js) and [`backend/src/routes/auth.js`](../backend/src/routes/auth.js):

| Control | Implementation Details | Threat Mitigated |
|---|---|---|
| **Authorization Code + PKCE (`S256`)** | 32-byte CSPRNG `code_verifier` (base64url), `code_challenge = BASE64URL(SHA-256(code_verifier))` sent to `https://access.line.me/oauth2/v2.1/authorize`. `code_verifier` stored server-side in `oauth_transactions` and sent during server-to-server token exchange. | Authorization code interception & injection (OAuth 2.1 best practice). |
| **Cryptographic `state` + Browser Transaction Binding** | Alphanumeric CSPRNG `state` stored in `oauth_transactions` (`SHA-256` indexed) AND bound to the initiating browser via short-lived `HttpOnly` cookie `pfs_oauth_tx` (10-minute TTL). Callback verifies `state` matches the DB record **and** `SHA-256(pfs_oauth_tx) === browser_Session_binding_hash`. | Login CSRF, session fixation via forged OAuth callbacks, cross-browser state replay. |
| **Atomic Single-Use `state` Consumption** | `UPDATE oauth_transactions SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?` checked for `changes === 1` before token exchange. | Replay attacks / concurrent double-redemption of authorization codes. |
| **OIDC `nonce` Verification** | Random alphanumeric `nonce` persisted in `oauth_transactions` and verified using constant-time comparison against the `nonce` claim inside the verified `id_token`. | ID token replay attacks. |
| **Cryptographic `id_token` Signature & Claim Verification** | Supports `HS256` (HMAC-SHA256 using `LINE_CHANNEL_SECRET`) and `ES256` (ECDSA P-256 SHA-256 verified against cached LINE JWKS `https://api.line.me/oauth2/v2.1/certs` by `kid`). Explicitly rejects `alg: "none"`, unsupported algorithms, invalid `iss` (`https://access.line.me`), wrong `aud` (`LINE_CHANNEL_ID`), missing `sub`, expired `exp` (with bounded 60s clock skew), or future `iat`. | Forged/tampered JWTs, algorithm confusion (`alg: none`), cross-channel token substitution. |
| **Least-Privilege Scope** | Requests `profile openid` by default (`email` is not requested unless explicitly enabled and approved). | Data minimization / PDPA compliance. |

---

## 3. Session, Cookie & CSRF Hardening

Implemented in [`backend/src/cookies.js`](../backend/src/cookies.js), [`backend/src/middleware/auth.js`](../backend/src/middleware/auth.js), and [`backend/src/middleware/security.js`](../backend/src/middleware/security.js):

- **Session Token Entropy & Storage**:
  - 32 bytes (256 bits) of CSPRNG entropy encoded as base64url.
  - Database stores `token_hash = SHA-256(raw_token)`. A read-only database leak or SQL dump cannot be used to hijack active user sessions.
- **Session Rotation on Login**:
  - If a browser already holds an active `pfs_session` cookie when completing `/api/v1/auth/line/callback`, the old session row is immediately revoked (`revoked_at` set, `revoke_reason = 'rotated_on_login'`) and a fresh session ID + token is issued.
- **Cookie Attributes**:
  - `HttpOnly` (always set; inaccessible to `document.cookie` / XSS).
  - `Path=/api/v1` (scoped strictly to API routes).
  - `Secure` (enforced automatically in `production` / `staging` or HTTPS origins; configurable via `COOKIE_SECURE`).
  - `SameSite=Lax` (default for same-site deployments) or `SameSite=None; Secure; Partitioned` (supported for cross-site GitHub Pages -> Cloudflare Workers deployments).
- **Dual-Layer CSRF Defense on Mutating Endpoints (`POST`, `PUT`, `PATCH`, `DELETE`)**:
  1. **Origin Allowlist Check**: Validates `Origin` header (or `Referer` origin fallback) against `ALLOWED_ORIGINS`. Untrusted origins receive `403 CSRF_ORIGIN_DENIED`.
  2. **Session-Bound HMAC CSRF Token (`X-CSRF-Token`)**: `/api/v1/auth/me` issues `csrfToken = HMAC-SHA256(SESSION_SECRET, "csrf:" + session.id)`. [`shared/api-client.js`](../shared/api-client.js) keeps `csrfToken` **in closure memory only** and attaches `X-CSRF-Token` on state-changing requests. Constant-time HMAC verification rejects missing or mismatched tokens with `403 CSRF_TOKEN_INVALID`.

---

## 4. Input Validation, Mass-Assignment Prevention & Open-Redirect Blocking

- **Strict `return_to` Sanitization**:
  - `sanitizeReturnTo()` in [`backend/src/routes/auth.js`](../backend/src/routes/auth.js) accepts only relative paths starting with a single `/` (excluding `//`, `/\`, control characters, and `javascript:`/`data:` schemes) or URLs matching configured `FRONTEND_ORIGIN` + allowed base path. Malicious values like `https://evil.example`, `//evil.example`, or `javascript:alert(1)` safely fall back to `/index.html`.
- **Mass-Assignment Rejection (`PATCH /api/v1/members/me`)**:
  - Only `displayName`, `avatarUrl`, `bio`, `phone`, and `email` are accepted.
  - Supplying protected or unknown keys (`role`, `id`, `status`, `lineUserSub`, etc.) immediately returns `400 PROTECTED_OR_UNKNOWN_FIELD` rather than silently ignoring tampering attempts.
  - `avatarUrl` is restricted to `https://` URLs (`<= 1024` chars), preventing `javascript:` or `data:` XSS vectors in profile avatars.
- **Parameterized SQL Everywhere**:
  - Every query across all routes and services uses prepared statements (`.prepare(sql).bind(...)`) with strict SQLite `FOREIGN KEY` and `CHECK` constraints enabled.

---

## 5. Rate Limiting, Security Headers & Secret Redaction

- **D1-Backed Fixed-Window Rate Limiting** ([`backend/src/middleware/rate-limit.js`](../backend/src/middleware/rate-limit.js)):
  - Auth endpoints (`/auth/line/start`, `/auth/line/callback`): default `20 req / 60s` per client IP (`429 RATE_LIMITED` + `Retry-After`).
  - General API endpoints: default `120 req / 60s` per client IP.
- **HTTP Security Headers** ([`backend/src/middleware/security.js`](../backend/src/middleware/security.js)):
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'` on API responses
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Cache-Control: no-store` on all `/auth/*` and `/members/*` responses
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `Secure` is enabled
- **Structured Log & Audit Redaction** ([`backend/src/logger.js`](../backend/src/logger.js), [`backend/src/services/audit.js`](../backend/src/services/audit.js)):
  - Automatically redacts keys matching `secret`, `token`, `authorization`, `cookie`, `code_verifier`, `nonce`, or `password` before writing to logs or `audit_logs.metadata_json`.
