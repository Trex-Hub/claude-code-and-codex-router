import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./env";

/**
 * Minimal structural types for node:sqlite's synchronous API.
 *
 * Declared locally (rather than `import ... from "node:sqlite"`) so tooling
 * that does not yet know the `node:sqlite` builtin — e.g. Vite in tests — does
 * not try to resolve it. The module is loaded through `createRequire` at
 * runtime.
 */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

/**
 * Single process-wide SQLite handle (node:sqlite, no native dependency).
 *
 * Cached on globalThis so Next's dev-mode module reload does not open a new
 * connection on every edit.
 */
declare global {
  // eslint-disable-next-line no-var
  var __claudeRelayDb: SqliteDatabase | undefined;
}

export function getDb(): SqliteDatabase {
  if (globalThis.__claudeRelayDb) {
    return globalThis.__claudeRelayDb;
  }

  const path = env.sqlitePath();
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  globalThis.__claudeRelayDb = db;
  return db;
}

/** Current epoch milliseconds. */
export function now(): number {
  return Date.now();
}
