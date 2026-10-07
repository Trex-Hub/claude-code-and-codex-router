-- migrate:up

ALTER TABLE accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE accounts ADD COLUMN chatgpt_account_id TEXT;

CREATE INDEX idx_accounts_provider_state ON accounts (provider, state);

-- migrate:down

DROP INDEX idx_accounts_provider_state;
ALTER TABLE accounts DROP COLUMN chatgpt_account_id;
ALTER TABLE accounts DROP COLUMN provider;
