import { readFileSync } from "node:fs";

// Configure the environment before any lib module reads it.
process.env.DATABASE_URL = "sqlite::memory:";
process.env.RELAY_ADMIN_PASSWORD = "test-password";
process.env.RELAY_SESSION_SECRET = "test-secret";

// Build the schema from the real migration so tests exercise the shipped DDL.
const { getDb } = await import("../src/lib/db");
const migration = readFileSync(
  new URL("../db/migrations/20261003000000_init.sql", import.meta.url),
  "utf8",
);
const up = migration.split("-- migrate:down")[0];
getDb().exec(up);
