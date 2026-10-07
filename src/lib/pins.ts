import { getDb, now } from "./db";
import type { Provider } from "./accounts";

/**
 * How long a pin stays useful, per provider. This tracks the prompt-cache
 * window: once the upstream cache entry has expired, keeping the conversation
 * on the same seat buys nothing, so selection is free to rebalance.
 *
 * Anthropic's prompt cache TTL is 5 minutes. The Codex backend's window is not
 * documented; 5 minutes is used as a conservative default.
 */
const PIN_TTL_MS: Record<Provider, number> = {
  anthropic: 5 * 60_000,
  "openai-codex": 5 * 60_000,
};

export function pinTtlMs(provider: Provider): number {
  return PIN_TTL_MS[provider];
}

interface PinRow {
  affinity_key: string;
  account_id: string;
  provider: string;
  created_at: number;
  expires_at: number;
}

/**
 * The account a conversation is pinned to, or null when there is no live pin.
 * An expired pin is treated as absent (and deleted opportunistically).
 */
export function getPin(affinityKey: string, provider: Provider): string | null {
  const row = getDb()
    .prepare("SELECT * FROM affinity_pins WHERE affinity_key = ?")
    .get(affinityKey) as unknown as PinRow | undefined;
  if (!row) return null;

  if (row.provider !== provider || row.expires_at <= now()) {
    deletePin(affinityKey);
    return null;
  }
  return row.account_id;
}

/**
 * Records that a conversation now belongs to `accountId`. Overwrites any
 * previous pin: this is what makes failover sticky, so a conversation moved off
 * a rate-limited seat stays moved instead of snapping back when it recovers.
 */
export function setPin(
  affinityKey: string,
  provider: Provider,
  accountId: string,
): void {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO affinity_pins
         (affinity_key, account_id, provider, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(affinity_key) DO UPDATE SET
         account_id = excluded.account_id,
         provider = excluded.provider,
         expires_at = excluded.expires_at`,
    )
    .run(affinityKey, accountId, provider, ts, ts + pinTtlMs(provider));
}

export function deletePin(affinityKey: string): void {
  getDb().prepare("DELETE FROM affinity_pins WHERE affinity_key = ?").run(affinityKey);
}

/** Drops pins for an account that is gone, so selection stops chasing it. */
export function deletePinsForAccount(accountId: string): void {
  getDb().prepare("DELETE FROM affinity_pins WHERE account_id = ?").run(accountId);
}

/** Removes expired pins. Called before selection alongside reapCooldowns. */
export function reapPins(): void {
  getDb().prepare("DELETE FROM affinity_pins WHERE expires_at <= ?").run(now());
}
