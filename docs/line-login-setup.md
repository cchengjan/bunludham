# Official LINE Login v2.1 Setup Guide

This guide explains how to configure a **LINE Login v2.1** channel in the [LINE Developers Console](https://developers.line.biz/console/) and connect it to the Bunludham Membership Backend API.

---

## 1. Create a LINE Login Channel

1. Sign in to the [LINE Developers Console](https://developers.line.biz/console/).
2. Select (or create) your **Provider** (e.g., organization/project provider; avoid using a personal test provider for production).
3. Click **Create a new channel** -> select **LINE Login**.
4. Fill in required channel details:
   - **Channel name**: e.g. `กฐินคุณยายฯ — สมาชิกภาพกิจกรรม`
   - **Channel description**: ระบบสมาชิกและรับข่าวสารงานบุญ กฐินคุณยายฯ
   - **App types**: check **Web app**
5. Once created:
   - Under **Basic settings**, note the **Channel ID** (`LINE_CHANNEL_ID`) and **Channel secret** (`LINE_CHANNEL_SECRET`).
   - Under **LINE Login** tab -> **Callback URL**, register the exact backend callback URL(s):
     - **Local development**:
       ```text
       http://localhost:8787/api/v1/auth/line/callback
       ```
     - **Staging** (example):
       ```text
       https://api-staging.example.com/api/v1/auth/line/callback
       ```
     - **Production** (Cloudflare Workers or custom API domain):
       ```text
       https://<your-worker-or-custom-api-domain>/api/v1/auth/line/callback
       ```

---

## 2. Scopes & OpenID Connect Configuration

The Bunludham backend requests only minimal permissions required for membership authentication:

- **`profile`** — Display name and profile picture URL
- **`openid`** — OpenID Connect `id_token` containing cryptographically signed identity claims (`iss`, `sub`, `aud`, `exp`, `iat`, `nonce`)

> **Privacy by Design**:
> - `email` scope is **not** requested by default. If you decide to collect emails in the future, you must first submit an Email Address Permission application in the LINE Developers Console and add explicit UI disclosure.
> - Social graph / friend list / message-sending scopes are **never** requested.

---

## 3. Protocol Flow Implemented

1. **Authorization Request (`GET /api/v1/auth/line/start`)**:
   - Validates `return_to` against the strict `ALLOWED_ORIGINS` allowlist.
   - Generates:
     - `state`: 43-char unbiased cryptographically random alphanumeric string (`A-Za-z0-9`)
     - `nonce`: 256-bit random base64url string
     - `code_verifier`: 256-bit random base64url PKCE verifier + `code_challenge = BASE64URL(SHA256(code_verifier))` (`code_challenge_method=S256`)
     - `pfs_oauth_tx`: 256-bit random `HttpOnly; SameSite=Lax; Path=/api/v1/auth/line` cookie binding the OAuth transaction to the initiating browser.
   - Stores `SHA-256(state)`, `SHA-256(pfs_oauth_tx)`, `nonce`, `code_verifier`, and `return_to` in `oauth_transactions` with a 10-minute expiration.
   - Redirects (`302`) to `https://access.line.me/oauth2/v2.1/authorize`.

2. **Callback & Token Exchange (`GET /api/v1/auth/line/callback`)**:
   - Verifies both `state` and `pfs_oauth_tx` cookie and atomically marks the transaction consumed (`UPDATE ... WHERE consumed_at IS NULL AND expires_at > ?`), defeating replay and concurrent race attacks.
   - Exchanges `code` + `code_verifier` + `LINE_CHANNEL_SECRET` server-to-server via `POST https://api.line.me/oauth2/v2.1/token`.
   - Verifies the returned `id_token` signature (`HS256` with `LINE_CHANNEL_SECRET` or `ES256` via LINE JWKS `https://api.line.me/oauth2/v2.1/certs`) and validates `iss === "https://access.line.me"`, `aud === LINE_CHANNEL_ID`, non-empty `sub`, `exp > now`, `iat`, and `nonce`.
   - Upserts internal `members` + `auth_identities`, rotates any pre-existing session, issues an opaque `HttpOnly` `pfs_session` cookie, clears `pfs_oauth_tx`, and redirects back to the frontend.

---

## 4. Local Development Configuration

1. Copy the example environment file:
   ```bash
   cp backend/.dev.vars.example backend/.dev.vars
   ```
2. Populate `backend/.dev.vars` with your test LINE Login channel credentials and a 32+ byte random `SESSION_SECRET`:
   ```ini
   APP_ENV=development
   PORT=8787
   FRONTEND_ORIGIN=http://localhost:8080
   ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
   LINE_CHANNEL_ID=200xxxxxxx
   LINE_CHANNEL_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   LINE_REDIRECT_URI=http://localhost:8787/api/v1/auth/line/callback
   SESSION_SECRET=generate_with_openssl_rand_hex_32
   COOKIE_SAME_SITE=Lax
   ```
3. Run migrations and start the backend API:
   ```bash
   npm --prefix backend run db:migrate
   npm --prefix backend run dev
   ```
4. Serve the repository root on `http://localhost:8080` (e.g. `python3 -m http.server 8080`) and click **“เข้าสู่ระบบด้วย LINE”** in the header.
