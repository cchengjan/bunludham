-- =============================================================================
-- Development-Only Seed Data (NEVER apply in production)
-- =============================================================================

INSERT OR IGNORE INTO members (
  id,
  display_name,
  display_name_customized,
  picture_url,
  email,
  role,
  status,
  news_opt_in,
  preferred_frame_category,
  created_at,
  updated_at,
  last_login_at
) VALUES (
  'mem_dev_sample_0001',
  'สาธุชนตัวอย่าง (Dev)',
  0,
  NULL,
  NULL,
  'MEMBER',
  'ACTIVE',
  1,
  'กฐิน',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO auth_identities (
  id,
  member_id,
  provider,
  provider_subject,
  provider_display_name,
  provider_picture_url,
  provider_amr_json,
  created_at,
  updated_at,
  last_login_at
) VALUES (
  'ident_dev_sample_0001',
  'mem_dev_sample_0001',
  'line',
  'U00000000000000000000000000000dev',
  'สาธุชนตัวอย่าง (Dev)',
  NULL,
  '["linesso"]',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO consents (
  id,
  member_id,
  consent_type,
  policy_version,
  granted,
  recorded_at,
  revoked_at,
  updated_at
) VALUES
  (
    'con_dev_privacy_0001',
    'mem_dev_sample_0001',
    'PRIVACY_POLICY',
    '2026-01',
    1,
    '2026-01-01T00:00:00.000Z',
    NULL,
    '2026-01-01T00:00:00.000Z'
  ),
  (
    'con_dev_news_0001',
    'mem_dev_sample_0001',
    'NEWS_PR',
    '2026-01',
    1,
    '2026-01-01T00:00:00.000Z',
    NULL,
    '2026-01-01T00:00:00.000Z'
  );
