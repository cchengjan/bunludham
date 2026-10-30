# Backend API Reference (`/api/v1`)

Base path: `/api/v1`

All responses set strict security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`).

State-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) require:
1. Valid `pfs_session` `HttpOnly` cookie (`credentials: 'include'`)
2. `Origin` header matching `ALLOWED_ORIGINS`
3. `X-CSRF-Token` header matching the session-bound token returned by `GET /api/v1/auth/me`

---

## 1. Health Check

### `GET /api/v1/health`

Checks Worker liveness, D1 database connectivity, and whether LINE OAuth credentials are configured (never exposes secret values).

- **200 OK**:
  ```json
  {
    "ok": true,
    "service": "bunludham-membership-api",
    "version": "1.0.0",
    "environment": "production",
    "database": "connected",
    "lineLoginConfigured": true,
    "timestamp": "2026-10-28T06:00:00.000Z"
  }
  ```
- **503 Service Unavailable**: `{ "ok": false, "error": { "code": "DATABASE_UNAVAILABLE", "message": "..." } }`

---

## 2. Authentication & Session Endpoints

### `GET /api/v1/auth/line/start?return_to=<url>`

Initiates Official LINE Login v2.1 Authorization Code + PKCE (`S256`) + OIDC flow.

- **Query Parameters**:
  - `return_to` *(optional)*: Relative path (e.g. `/index.html`) or full URL matching `ALLOWED_ORIGINS`. Untrusted URLs are rejected with `400 INVALID_RETURN_TO`.
- **Response**: `302 Found` redirecting to `https://access.line.me/oauth2/v2.1/authorize?...` and setting `HttpOnly` cookie `pfs_oauth_tx`.
- **Rate Limit**: 20 requests / minute / IP (`429 RATE_LIMITED`).

### `GET /api/v1/auth/line/callback?code=...&state=...`

Handles LINE redirect callback, atomically consumes single-use `state`, exchanges `code` + `code_verifier` with LINE, cryptographically verifies `id_token` (`HS256` or `ES256` JWKS), rotates any existing session, sets `pfs_session` `HttpOnly` cookie, and redirects back to the frontend.

- **Success Redirect**: `<return_to>?auth_login=success`
- **Failure / Cancel Redirect**: `<return_to>?auth_error=<cancelled|expired_state|invalid_state|provider_error|token_exchange_failed|invalid_id_token|account_suspended>`

### `GET /api/v1/auth/me`

Returns current session authentication status and session-bound `csrfToken`.

- **200 OK (Anonymous Guest — no cookie)**:
  ```json
  {
    "ok": true,
    "authenticated": false,
    "member": null,
    "csrfToken": null
  }
  ```
- **200 OK (Authenticated Member)**:
  ```json
  {
    "ok": true,
    "authenticated": true,
    "csrfToken": "8f2a...hmac_hex",
    "session": {
      "expiresAt": "2026-11-04T06:00:00.000Z"
    },
    "member": {
      "id": "mem_AbCdEfGhIjKlMnOpQrStUvWx",
      "displayName": "สาธุชน ผู้ใจบุญ",
      "pictureUrl": "https://profile.line-scdn.net/...",
      "role": "MEMBER",
      "newsOptIn": true,
      "preferredFrameCategory": "กฐิน"
    }
  }
  ```
- **401 Unauthorized (Expired or Revoked Cookie)**: Clears `pfs_session` cookie and returns `{ "ok": false, "error": { "code": "SESSION_EXPIRED", "message": "..." } }`.

### `POST /api/v1/auth/logout`

Revokes the server-side session record in D1 and clears the `pfs_session` cookie.

- **Headers**: `Origin`, `X-CSRF-Token`
- **200 OK**: `{ "ok": true, "loggedOut": true }`

---

## 3. Member Profile & Consent Endpoints

### `GET /api/v1/members/me`

Returns full member profile, linked OAuth provider metadata (without raw provider tokens), and current PDPA consents.

- **401 Unauthorized** if unauthenticated.

### `PATCH /api/v1/members/me`

Updates allowlisted member profile fields for the authenticated member only.

- **Allowed JSON Fields ONLY**:
  - `displayName` (`string`, 1–80 chars after whitespace normalization and `<`/`>` stripping)
  - `newsOptIn` (`boolean` — also synchronizes `NEWS_PR` consent record)
  - `preferredFrameCategory` (`null` or one of `'ทั้งหมด' | 'กฐิน' | 'มุทิตาสักการะ' | 'งานบุญ' | 'พิธี' | 'อื่น ๆ'`)
- **Protected / Unknown Fields**: Any other field (`id`, `role`, `status`, `provider_subject`, `createdAt`, etc.) is rejected with `400 FORBIDDEN_OR_UNKNOWN_FIELD`.

### `GET /api/v1/members/me/consents`

Returns `currentPolicyVersion` and consent status for `PRIVACY_POLICY`, `TERMS_OF_USE`, and `NEWS_PR`.

### `PUT /api/v1/members/me/consents`

Records or revokes member consents with timestamps and policy version.

- **Request Body**:
  ```json
  {
    "policyVersion": "2026-01",
    "consents": {
      "PRIVACY_POLICY": true,
      "TERMS_OF_USE": true,
      "NEWS_PR": false
    }
  }
  ```

---

## 4. Server-Verified Admin Endpoint

### `GET /api/v1/admin/stats`

Returns aggregate non-PII membership statistics (`totalActiveMembers`, `newsOptInMembers`, `activeSessions`).

- **Authorization**: Enforces `member.role === 'ADMIN'` strictly on the server. Regular LINE Login users always receive `role = 'MEMBER'` and get `403 FORBIDDEN_ADMIN_ONLY`.
