# Deployment Runbook (GitHub Pages + Cloudflare Workers & D1)

This runbook walks through deploying **Bunludham Photo Frame Studio** to production while preserving existing zero-build GitHub Pages hosting and optional Google Apps Script (`backend/Code.gs`) compatibility.

---

## 1. Deployment Topology Options

### Option A — Recommended Same-Site Custom Domain (Simplest Cookie Policy)
- **Static Frontend (GitHub Pages / Cloudflare Pages)**: `https://app.yourdomain.com`
- **Backend API (Cloudflare Workers + D1)**: `https://api.yourdomain.com` (or route `https://app.yourdomain.com/api/v1/*`)
- **Cookie Configuration**: `COOKIE_SAME_SITE = "Lax"`, `COOKIE_SECURE = "true"` (works across all browsers including Safari ITP without partitioned cookie requirements).

### Option B — Default GitHub Pages + `workers.dev` Subdomain (Zero Custom Domain Cost)
- **Static Frontend (GitHub Pages)**: `https://cchengjan.github.io/bunludham`
- **Backend API (Cloudflare Workers + D1)**: `https://bunludham-api.<your-subdomain>.workers.dev`
- **Cookie Configuration**: `COOKIE_SAME_SITE = "None"`, `COOKIE_SECURE = "true"` (automatically emits `HttpOnly; Secure; SameSite=None; Partitioned; Path=/api/v1` + strict `Origin` & `X-CSRF-Token` verification).

---

## 2. Local Development Quickstart

1. **Create Local Dev Secrets** (`backend/.dev.vars` — gitignored):
   ```bash
   cp backend/.dev.vars.example backend/.dev.vars
   ```
   Fill in `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` (from a Development LINE Login Channel with callback `http://localhost:8787/api/v1/auth/line/callback`), and a random 32+ byte `SESSION_SECRET`:
   ```bash
   openssl rand -hex 32
   ```

2. **Run Local Database Migrations (Optional Seed)**:
   ```bash
   npm --prefix backend run db:migrate:seed
   ```

3. **Start Local Backend API (`http://localhost:8787`)**:
   ```bash
   npm --prefix backend run dev
   ```

4. **Serve Static Frontend (`http://localhost:8080`)**:
   ```bash
   python3 -m http.server 8080
   ```
   When running on `localhost` or `127.0.0.1`, [`config.js`](../config.js) automatically targets `http://localhost:8787/api/v1` and enables the LINE Login UI.

---

## 3. Production Cloudflare Workers + D1 Provisioning

### Step 1 — Authenticate Wrangler CLI
```bash
npm --prefix backend run cf:login
```

### Step 2 — Create Production (and Optional Staging) D1 Database
```bash
npm --prefix backend run cf:d1:create:production
```
Copy the returned `database_id` (UUID format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) into [`backend/wrangler.toml`](../backend/wrangler.toml) under `[[env.production.d1_databases]]` (replace `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID`).

### Step 3 — Update Public Non-Secret Variables in `backend/wrangler.toml`
Under `[env.production.vars]` in [`backend/wrangler.toml`](../backend/wrangler.toml), confirm:
- `FRONTEND_ORIGIN`: e.g. `"https://cchengjan.github.io"`
- `FRONTEND_BASE_PATH`: e.g. `"/bunludham"` (or `""` if hosted at root domain)
- `ALLOWED_ORIGINS`: `"https://cchengjan.github.io"`
- `LINE_REDIRECT_URI`: `"https://<your-worker-domain>/api/v1/auth/line/callback"`
- `COOKIE_SAME_SITE`: `"None"` (if cross-domain GitHub Pages + `workers.dev`) or `"Lax"` (if same-site custom domain)

### Step 4 — Apply D1 Schema Migrations Remotely
```bash
npm --prefix backend run cf:d1:migrate:production
```
> **Important**: Never run `seeds/dev_seed.sql` against staging or production databases.

### Step 5 — Upload Encrypted Worker Secrets
```bash
npx --prefix backend wrangler secret put LINE_CHANNEL_ID -c backend/wrangler.toml --env production
npx --prefix backend wrangler secret put LINE_CHANNEL_SECRET -c backend/wrangler.toml --env production
npx --prefix backend wrangler secret put SESSION_SECRET -c backend/wrangler.toml --env production
```

### Step 6 — Deploy the Cloudflare Worker
```bash
npm --prefix backend run cf:deploy:production
```
Verify health endpoint:
```bash
curl -i https://<your-worker-domain>/api/v1/health
```
Expected HTTP `200` response:
```json
{
  "ok": true,
  "service": "bunludham-membership-api",
  "version": "1.0.0",
  "environment": "production",
  "database": "connected",
  "lineLoginConfigured": true
}
```

---

## 4. Configuring Static Frontend (`config.js`) & GitHub Pages

1. Edit [`config.js`](../config.js) with your public production Worker API URL (no secrets!):
   ```javascript
   apiBaseUrl: 'https://bunludham-membership-api.cchengjan63-a3b.workers.dev',
   ```
2. Commit and push to GitHub Pages branch (`main`) once reviewed and approved.
3. Confirm in **LINE Developers Console -> LINE Login -> Callback URL** that the exact `LINE_REDIRECT_URI` (`https://bunludham-membership-api.cchengjan63-a3b.workers.dev/api/v1/auth/line/callback`) is registered and that **OpenID Connect (`openid`)** is enabled.

---

## 5. Promoting an Initial Server `ADMIN` Member

By design, logging in with LINE creates a member with `role = 'MEMBER'`. To grant server-side `ADMIN` privileges (for `/api/v1/admin/stats` and future server admin endpoints) after an administrator logs in once via LINE:

```bash
npx --prefix backend wrangler d1 execute bunludham-db -c backend/wrangler.toml --remote --env production \
  --command "UPDATE members SET role = 'ADMIN', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'mem_<target_member_id>';"
```

---

## 6. Post-Deploy Smoke Checklist & Rollback

### Post-Deploy Smoke Checklist
- [ ] `GET /api/v1/health` returns `200 OK` with `"database": "ok"` and strict security headers.
- [ ] Public photo upload, framing, zoom/pan, and PNG download on `index.html` and `create.html` work **without** logging in.
- [ ] Clicking **"เข้าสู่ระบบด้วย LINE"** redirects to `access.line.me` with `code_challenge_method=S256`, `state`, and `nonce`, then returns to the originating page with `pfs_session` set (`HttpOnly; Secure`).
- [ ] Opening the member profile modal updates display name / PDPA consents and persists across page reloads.
- [ ] Clicking **"ออกจากระบบ"** revokes the session (`GET /api/v1/auth/me` returns `authenticated: false`).

### Rollback Procedure
- **Frontend Instant Feature-Flag Rollback**: Set `enableLineLogin: false` in [`config.js`](../config.js) (or revert the commit). The static photo studio continues operating 100% client-side.
- **Worker Rollback**: Run `npx --prefix backend wrangler rollback -c backend/wrangler.toml --env production` to revert immediately to the previous Cloudflare Worker deployment revision.
