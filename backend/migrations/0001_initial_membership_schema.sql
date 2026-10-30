-- =============================================================================
-- Migration: 0001_initial_membership_schema.sql
-- Bunludham Membership & Official LINE Login v2.1 / OIDC Schema (SQLite / D1)
-- =============================================================================

-- 1. Core Member Account (Internal ID decoupled from OAuth provider subject)
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  display_name_customized INTEGER NOT NULL DEFAULT 0 CHECK (display_name_customized IN (0, 1)),
  picture_url TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER', 'ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  news_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (news_opt_in IN (0, 1)),
  preferred_frame_category TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_role ON members(role);

-- 2. External OAuth / OIDC Identity Mapping
CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('line')),
  provider_subject TEXT NOT NULL CHECK (length(trim(provider_subject)) > 0),
  provider_display_name TEXT,
  provider_picture_url TEXT,
  provider_amr_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_member_id ON auth_identities(member_id);

-- 3. Short-Lived Single-Use OAuth 2.1 + PKCE + OIDC Transactions
CREATE TABLE IF NOT EXISTS oauth_transactions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'line' CHECK (provider IN ('line')),
  state_hash TEXT NOT NULL UNIQUE,
  tx_token_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_transactions_expires_at ON oauth_transactions(expires_at);

-- 4. Opaque Server-Managed Sessions (Token Stored as SHA-256 Hash Only)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  ip_hash TEXT,
  user_agent_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 5. Member Privacy & Communication Consents
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('PRIVACY_POLICY', 'TERMS_OF_USE', 'NEWS_PR')),
  policy_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  recorded_at TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(member_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_consents_member_id ON consents(member_id);

-- 6. Security & Membership Audit Log (No Raw Tokens or Secrets)
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'MEMBER', 'ANONYMOUS', 'ADMIN')),
  ip_hash TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_member_created ON audit_logs(member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_created ON audit_logs(event_type, created_at);

-- 7. Distributed / Per-DB Fixed-Window Rate Limit Buckets
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count >= 0),
  window_start_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at ON rate_limits(expires_at_ms);
