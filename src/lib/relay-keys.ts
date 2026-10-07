import { randomBytes, randomUUID } from "node:crypto";
import { getDb, now } from "./db";

export interface RelayKey {
  id: string;
  key: string;
  label: string | null;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

interface RelayKeyRow {
  id: string;
  key: string;
  label: string | null;
  created_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
}

function toKey(row: RelayKeyRow): RelayKey {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

export function listKeys(): RelayKey[] {
  const rows = getDb()
    .prepare("SELECT * FROM relay_keys ORDER BY created_at ASC")
    .all() as unknown as RelayKeyRow[];
  return rows.map(toKey);
}

export function createKey(label: string | null): RelayKey {
  const id = randomUUID();
  const key = `cr_live_${randomBytes(24).toString("hex")}`;
  getDb()
    .prepare(
      "INSERT INTO relay_keys (id, key, label, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, key, label, now());
  return { id, key, label, createdAt: now(), revokedAt: null, lastUsedAt: null };
}

export function revokeKey(id: string): void {
  getDb().prepare("UPDATE relay_keys SET revoked_at = ? WHERE id = ?").run(now(), id);
}

export function deleteKey(id: string): void {
  getDb().prepare("DELETE FROM relay_keys WHERE id = ?").run(id);
}

/** Looks up a non-revoked key. Returns undefined when unknown or revoked. */
export function findActiveKey(key: string): RelayKey | undefined {
  const row = getDb()
    .prepare("SELECT * FROM relay_keys WHERE key = ? AND revoked_at IS NULL")
    .get(key) as unknown as RelayKeyRow | undefined;
  return row ? toKey(row) : undefined;
}

/**
 * Reads the relay key from a request. Pi's `anthropic-messages` client sends
 * `x-api-key`; OpenAI-style clients send `Authorization: Bearer`.
 */
export function extractKey(req: Request): string | null {
  const apiKey = req.headers.get("x-api-key")?.trim();
  if (apiKey) return apiKey;
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  return key || null;
}

export function touchKey(id: string): void {
  getDb().prepare("UPDATE relay_keys SET last_used_at = ? WHERE id = ?").run(now(), id);
}
