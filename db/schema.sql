CREATE TABLE IF NOT EXISTS "schema_migrations" (version varchar(128) primary key);
CREATE TABLE accounts (
  id                          TEXT PRIMARY KEY,
  label                       TEXT NOT NULL,
  email                       TEXT,
  org_name                    TEXT,
  organization_type           TEXT,
  plan_tier                   TEXT,
  seat_tier                   TEXT,
  rate_limit_tier             TEXT,
  subscription_status         TEXT,
  has_extra_usage_enabled     INTEGER,
  access_token                TEXT NOT NULL,
  refresh_token               TEXT NOT NULL,
  access_expires_at           INTEGER NOT NULL,
  state                       TEXT NOT NULL DEFAULT 'active',
  cooldown_until              INTEGER,
  last_error                  TEXT,
  last_selected_at            INTEGER,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
, provider TEXT NOT NULL DEFAULT 'anthropic', chatgpt_account_id TEXT);
CREATE INDEX idx_accounts_state ON accounts (state);
CREATE TABLE relay_keys (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  last_used_at INTEGER
);
CREATE TABLE usage_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id         TEXT NOT NULL,
  relay_key_id       TEXT,
  model              TEXT,
  request_id         TEXT,
  input_tokens       INTEGER,
  output_tokens      INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  status             INTEGER,
  latency_ms         INTEGER,
  created_at         INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts (id),
  FOREIGN KEY (relay_key_id) REFERENCES relay_keys (id)
);
CREATE INDEX idx_usage_created ON usage_events (created_at);
CREATE INDEX idx_usage_account ON usage_events (account_id, created_at);
CREATE INDEX idx_accounts_provider_state ON accounts (provider, state);
-- Dbmate schema migrations
INSERT INTO "schema_migrations" (version) VALUES
  ('20261003000000'),
  ('20261004000000');
