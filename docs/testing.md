# Automated Testing & QA Verification Guide

This document describes how to execute all automated frontend, backend, database, security, and Storage v3 tests in `bunludham`, what each suite verifies, and what remains gated on live external credentials.

---

## 1. Quick Start — Running All Tests

### A. Automated Node Test Suite (Backend + Storage v3 + Security + Frontend Integration)
Requires **Node.js `>= 22.5.0`** (uses built-in `node:test`, `node:assert`, and `node:sqlite` — zero external test runner dependencies required):

```bash
npm --prefix backend test
```

Or from inside `backend/`:
```bash
npm test
```

### B. Browser-Based Static QA Runner (`test_runner.html`)
Open [`test_runner.html`](../test_runner.html) in any modern browser (directly or via any static HTTP server such as VS Code Live Server / `python3 -m http.server 8080`):
- Executes **16 in-browser assertions** covering the 10 original application/DOM/Quote/Frame/DriveSync checks plus **6 new Storage v3 regression tests**.
- Computes real pass/fail percentages (`Math.round((passed / total) * 100)`) instead of a hardcoded `100%` badge.

---

## 2. Node Automated Test Suite Inventory (`28` Tests Across `5` Suites)

| Suite File | Tests | Key Scenarios Verified |
|---|---|---|
| [`backend/tests/storage-v3.test.mjs`](../backend/tests/storage-v3.test.mjs) | 6 | 1. Executes all 16 browser assertions inside `test_runner.html` with 100% pass rate<br>2. Deterministic `v2 -> v3` migration + `pfs_frames_v2_backup` creation + never auto-deleting `v2`<br>3. Corrupted `pfs_frames_v2` JSON handled safely with fallback to seed frames<br>4. Cross-tab `storage` sync on `pfs_frames_v3`, ignoring unrelated/`v2` keys, singleton listener guard<br>5. Rejects malformed, unsupported-version, or unsafe-URL backups with atomic rollback on write failure<br>6. `resetDefaults()` resets canonical v3 frames/quotes/activities, preserves unrelated keys, and persists across reload |
| [`backend/tests/migrations-and-db.test.mjs`](../backend/tests/migrations-and-db.test.mjs) | 4 | 1. Applies migrations idempotently and tracks `SHA-256` checksums in `schema_migrations`<br>2. Detects tampered migration checksums and refuses to proceed<br>3. Allows `dev_seed.sql` in development and blocks dev seed in `staging` / `production`<br>4. Enforces `UNIQUE(provider, provider_subject)`, `CHECK` constraints, and `FOREIGN KEY` cascades |
| [`backend/tests/line-login.test.mjs`](../backend/tests/line-login.test.mjs) | 7 | 1. Constructs compliant LINE v2.1 authorization URL with alphanumeric `state`, `nonce`, PKCE `S256`, and minimal scope (`profile openid`)<br>2. Completes valid `HS256` login flow, verifies PKCE `code_verifier`, creates decoupled `member_id`, and rotates session on re-login<br>3. Verifies `ES256` asymmetric `id_token` signatures using LINE OIDC JWKS endpoint (`https://api.line.me/oauth2/v2.1/certs`)<br>4. Handles user cancellation (`access_denied`) and upstream OAuth errors safely<br>5. Rejects missing, mismatched, expired, and replayed `state` as well as concurrent duplicate callbacks<br>6. Rejects invalid authorization code and all malformed/forged `id_token` variants (`alg: none`, wrong `iss`/`aud`/`nonce`, expired `exp`)<br>7. Never leaks raw OAuth codes, access/ID tokens, secrets, or raw session tokens into logs or DB |
| [`backend/tests/api-and-security.test.mjs`](../backend/tests/api-and-security.test.mjs) | 7 | 1. Boots local HTTP Worker server and serves `GET /api/v1/health` with security headers<br>2. Handles database failure safely with `503` and leaks no SQL or stack trace<br>3. Enforces `401` on unauthorized, expired, and revoked sessions across protected endpoints<br>4. Validates `PATCH /api/v1/members/me` allowlist, rejects protected/unknown fields (`400`), and isolates members<br>5. Records and revokes member consents via `GET/PUT /api/v1/members/me/consents` and revokes session on `POST /auth/logout`<br>6. Blocks CSRF attacks, untrusted CORS origins, open redirects, unauthorized `ADMIN` access (`403`), and rate-limit floods (`429`)<br>7. Passes static repository security scan (zero secrets, zero unparameterized SQL, zero auth tokens in `LocalStorage`) |
| [`backend/tests/frontend-integration.test.mjs`](../backend/tests/frontend-integration.test.mjs) | 4 | 1. Preserves relative asset paths across HTML/JSON files and keeps `backend/Code.gs` intact<br>2. Degrades cleanly without errors when Backend API is offline, and initiates LINE Login on button click<br>3. Renders authenticated member pill, updates profile & PDPA consents, and logs out<br>4. Detects server-expired session (`401 SESSION_EXPIRED`) and renders Thai session-expired re-login prompt |

---

## 3. Verification Matrix (`PASS` vs `BLOCKED`)

| Verification Area | Status | Notes |
|---|---|---|
| Baseline & Extended Browser QA (`test_runner.html`, 16 tests) | **PASS** | All original 10 + 6 Storage v3 assertions verified; percentage bug fixed. |
| Storage v3 Migration, Cross-Tab Sync, Backup/Restore, Reset (`6` Node tests) | **PASS** | Verified in `storage-v3.test.mjs` including `QuotaExceededError` atomic rollback. |
| SQLite / D1 Schema Migrations, Checksums & Constraints (`4` Node tests) | **PASS** | Verified in `migrations-and-db.test.mjs` + CLI `npm run db:migrate:seed`. |
| Mocked LINE Login v2.1 + PKCE + OIDC (`HS256` & `ES256` JWKS) (`7` Node tests) | **PASS** | Verified in `line-login.test.mjs` against all positive & adversarial vectors. |
| API Profile, Consents, CSRF, CORS, RBAC, Rate Limit & Static Secret Scan (`7` Node tests) | **PASS** | Verified in `api-and-security.test.mjs`. |
| Frontend Integration (`api-client.js` + `member-auth.js` -> Worker API) (`4` Node tests) | **PASS** | Verified in `frontend-integration.test.mjs` across `index.html`, `create.html`, and `admin.html`. |
| **Live End-to-End Redirect Against Real LINE Platform (`access.line.me`)** | **BLOCKED (External Credentials)** | Requires provisioning a real LINE Login Channel (`LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`) in LINE Developers Console and registering the deployed HTTPS callback URL (`https://<api-domain>/api/v1/auth/line/callback`). Follow [`docs/line-login-setup.md`](./line-login-setup.md) and [`docs/deployment.md`](./deployment.md) to complete live verification. |
