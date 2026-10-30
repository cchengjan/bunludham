# Database Schema & Migrations (Cloudflare D1 / SQLite)

Migration files live in [`backend/migrations/`](../backend/migrations/) and are tracked with SHA-256 checksums in `schema_migrations`.

---

## 1. Entity-Relationship Diagram

```mermaid
erDiagram
  members ||--o{ auth_identities : "links provider identity"
  members ||--o{ sessions : "owns active sessions"
  members ||--o{ consents : "records PDPA consents"
  members ||--o{ audit_logs : "referenced by audit trail"

  members {
    TEXT id PK "mem_<24 alphanumeric>"
    TEXT display_name "1..80 chars"
    INTEGER display_name_customized "0 or 1"
    TEXT picture_url "HTTPS URL or NULL"
    TEXT email "NULL unless explicitly collected"
    TEXT role "'MEMBER' | 'ADMIN'"
    TEXT status "'ACTIVE' | 'SUSPENDED' | 'DELETED'"
    INTEGER news_opt_in "0 or 1"
    TEXT preferred_frame_category "Optional category"
    TEXT created_at "ISO-8601 UTC"
    TEXT updated_at "ISO-8601 UTC"
    TEXT last_login_at "ISO-8601 UTC"
  }

  auth_identities {
    TEXT id PK "ident_<24 alphanumeric>"
    TEXT member_id FK "REFERENCES members(id) ON DELETE CASCADE"
    TEXT provider "'line'"
    TEXT provider_subject "LINE OIDC sub (UNIQUE per provider)"
    TEXT provider_display_name
    TEXT provider_picture_url
    TEXT provider_amr_json
    TEXT created_at
    TEXT updated_at
    TEXT last_login_at
  }

  oauth_transactions {
    TEXT id PK "otx_<24 alphanumeric>"
    TEXT provider "'line'"
    TEXT state_hash UK "SHA-256(state)"
    TEXT tx_token_hash "SHA-256(pfs_oauth_tx cookie)"
    TEXT nonce "OIDC nonce"
    TEXT code_verifier "PKCE S256 verifier"
    TEXT return_to "Validated frontend URL"
    TEXT created_at
    TEXT expires_at "10-minute TTL"
    TEXT consumed_at "Atomic single-use timestamp"
    TEXT ip_hash "HMAC-SHA256 truncated"
  }

  sessions {
    TEXT id PK "ses_<24 alphanumeric>"
    TEXT token_hash UK "SHA-256(pfs_session cookie)"
    TEXT member_id FK "REFERENCES members(id) ON DELETE CASCADE"
    TEXT created_at
    TEXT expires_at
    TEXT last_seen_at
    TEXT revoked_at "Set on logout or rotation"
    TEXT revoke_reason
    TEXT ip_hash
    TEXT user_agent_summary
  }

  consents {
    TEXT id PK "con_<24 alphanumeric>"
    TEXT member_id FK "REFERENCES members(id) ON DELETE CASCADE"
    TEXT consent_type "'PRIVACY_POLICY' | 'TERMS_OF_USE' | 'NEWS_PR'"
    TEXT policy_version "e.g. '2026-01'"
    INTEGER granted "0 or 1"
    TEXT recorded_at
    TEXT revoked_at
    TEXT updated_at
  }

  audit_logs {
    TEXT id PK "aud_<24 alphanumeric>"
    TEXT event_type
    TEXT member_id FK "REFERENCES members(id) ON DELETE SET NULL"
    TEXT actor_type "'SYSTEM' | 'MEMBER' | 'ANONYMOUS' | 'ADMIN'"
    TEXT ip_hash
    TEXT metadata_json "Redacted JSON"
    TEXT created_at
  }

  rate_limits {
    TEXT bucket_key PK
    INTEGER count
    INTEGER window_start_ms
    INTEGER expires_at_ms
  }
```

---

## 2. Constraints & Indexes

- **`auth_identities`**: `UNIQUE(provider, provider_subject)` guarantees one LINE user (`sub`) can never accidentally create duplicate member accounts; `idx_auth_identities_member_id` indexes lookups by `member_id`.
- **`sessions`**: `token_hash` is `UNIQUE` (raw session tokens are never stored); indexed on `member_id` and `expires_at`.
- **`oauth_transactions`**: `state_hash` is `UNIQUE`; indexed on `expires_at` for automatic cleanup.
- **`consents`**: `UNIQUE(member_id, consent_type)` maintains one canonical current consent row per consent type while preserving `recorded_at` and `revoked_at` timestamps.
- **`audit_logs`**: Uses `ON DELETE SET NULL` for `member_id` so security audit records survive member deletion without dangling foreign keys.

---

## 3. Running Migrations & Seeds

### Local SQLite (`backend/.local/dev.sqlite`)
```bash
# Apply pending migrations (idempotent + checksum verified)
npm --prefix backend run db:migrate

# Apply migrations + development sample seed (blocked automatically if APP_ENV=production)
npm --prefix backend run db:seed
```

### Cloudflare D1
```bash
# Local Wrangler D1
npm --prefix backend run cf:d1:migrate:local

# Remote Staging / Production D1
npm --prefix backend run cf:d1:migrate:staging
npm --prefix backend run cf:d1:migrate:production
```
