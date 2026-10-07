import { getDb, now } from "./db";

export interface UsageInput {
  accountId: string;
  relayKeyId: string | null;
  model: string | null;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  status: number | null;
  latencyMs: number | null;
}

export interface UsageEvent extends UsageInput {
  id: number;
  createdAt: number;
}

export function recordUsage(input: UsageInput): void {
  getDb()
    .prepare(
      `INSERT INTO usage_events
        (account_id, relay_key_id, model, request_id, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, status, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.accountId,
      input.relayKeyId,
      input.model,
      input.requestId,
      input.inputTokens,
      input.outputTokens,
      input.cacheReadTokens,
      input.cacheWriteTokens,
      input.status,
      input.latencyMs,
      now(),
    );
}

export interface AccountUsageRow {
  accountId: string;
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  lastUsedAt: number | null;
}

export function usageByAccount(): AccountUsageRow[] {
  const rows = getDb()
    .prepare(
      `SELECT account_id AS accountId,
              COUNT(*) AS requests,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
              COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              MAX(created_at) AS lastUsedAt
       FROM usage_events
       GROUP BY account_id`,
    )
    .all() as unknown as AccountUsageRow[];
  return rows;
}

export function recentUsage(limit = 50): UsageEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT id, account_id AS accountId, relay_key_id AS relayKeyId, model,
              request_id AS requestId, input_tokens AS inputTokens,
              output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens,
              cache_write_tokens AS cacheWriteTokens, status, latency_ms AS latencyMs,
              created_at AS createdAt
       FROM usage_events ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as UsageEvent[];
  return rows;
}
