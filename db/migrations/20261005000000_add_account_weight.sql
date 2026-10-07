-- migrate:up

-- Relative share of new conversations this seat should attract. NULL means
-- "derive from the plan tier" (see planWeight in src/lib/accounts.ts); a
-- non-null value is an explicit override set from the dashboard.
ALTER TABLE accounts ADD COLUMN weight INTEGER;

-- migrate:down

ALTER TABLE accounts DROP COLUMN weight;
