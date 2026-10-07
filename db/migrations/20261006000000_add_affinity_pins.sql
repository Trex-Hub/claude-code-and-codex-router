-- migrate:up

-- Routes a conversation back to the account holding its warm prompt cache.
-- One row per affinity key; `expires_at` tracks the provider's cache window,
-- after which the pin is useless and selection is free to pick elsewhere.
CREATE TABLE affinity_pins (
  affinity_key TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts (id)
);

CREATE INDEX idx_affinity_pins_account ON affinity_pins (account_id);

-- migrate:down

DROP INDEX idx_affinity_pins_account;
DROP TABLE affinity_pins;
