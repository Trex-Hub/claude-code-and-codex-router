import { readdirSync, readFileSync } from "node:fs";

// Configure the environment before any lib module reads it.
process.env.DATABASE_URL = "sqlite::memory:";
process.env.RELAY_ADMIN_PASSWORD = "test-password";
process.env.RELAY_SESSION_SECRET = "test-secret";

// Build the schema from the real migrations so tests exercise the shipped DDL.
const migrationsDir = new URL("../db/migrations/", import.meta.url);
const { getDb } = await import("../src/lib/db");
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  const migration = readFileSync(new URL(file, migrationsDir), "utf8");
  getDb().exec(migration.split("-- migrate:down")[0]);
}
