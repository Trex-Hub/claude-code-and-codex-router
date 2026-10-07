import { randomUUID } from "node:crypto";
import { getDb, now } from "./db";
import { deletePinsForAccount } from "./pins";

export type AccountState = "active" | "cooling" | "disabled" | "error";

export type Provider = "anthropic" | "openai-codex";

export interface Account {
  id: string;
  provider: Provider;
  label: string;
  email: string | null;
  orgName: string | null;
  organizationType: string | null;
  planTier: string | null;
  seatTier: string | null;
  rateLimitTier: string | null;
  subscriptionStatus: string | null;
  hasExtraUsageEnabled: boolean | null;
  chatgptAccountId: string | null;
  /** Relative share of new conversations; NULL means "derive from plan". */
  weight: number | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  state: AccountState;
  cooldownUntil: number | null;
  lastError: string | null;
  lastSelectedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Account balance/subscription info fetched from Anthropic's profile endpoint. */
export interface AccountProfile {
  organizationType: string | null;
  rateLimitTier: string | null;
  seatTier: string | null;
  subscriptionStatus: string | null;
  hasExtraUsageEnabled: boolean | null;
  email: string | null;
  organizationName: string | null;
}

interface AccountRow {
  id: string;
  provider: string;
  label: string;
  email: string | null;
  org_name: string | null;
  organization_type: string | null;
  plan_tier: string | null;
  seat_tier: string | null;
  rate_limit_tier: string | null;
  subscription_status: string | null;
  has_extra_usage_enabled: number | null;
  chatgpt_account_id: string | null;
  weight: number | null;
  access_token: string;
  refresh_token: string;
  access_expires_at: number;
  state: string;
  cooldown_until: number | null;
  last_error: string | null;
  last_selected_at: number | null;
  created_at: number;
  updated_at: number;
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    provider: row.provider as Provider,
    label: row.label,
    email: row.email,
    orgName: row.org_name,
    organizationType: row.organization_type,
    planTier: row.plan_tier,
    seatTier: row.seat_tier,
    rateLimitTier: row.rate_limit_tier,
    subscriptionStatus: row.subscription_status,
    hasExtraUsageEnabled:
      row.has_extra_usage_enabled === null
        ? null
        : row.has_extra_usage_enabled === 1,
    chatgptAccountId: row.chatgpt_account_id,
    weight: row.weight,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessExpiresAt: row.access_expires_at,
    state: row.state as AccountState,
    cooldownUntil: row.cooldown_until,
    lastError: row.last_error,
    lastSelectedAt: row.last_selected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Account shape safe to send to the dashboard (tokens stripped). */
export function publicAccount(account: Account) {
  const { accessToken, refreshToken, ...rest } = account;
  void accessToken;
  void refreshToken;
  return rest;
}

export function listAccounts(): Account[] {
  const rows = getDb()
    .prepare("SELECT * FROM accounts ORDER BY created_at ASC")
    .all() as unknown as AccountRow[];
  return rows.map(toAccount);
}

export function getAccount(id: string): Account | undefined {
  const row = getDb()
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as unknown as AccountRow | undefined;
  return row ? toAccount(row) : undefined;
}

export interface NewAccount {
  /** Defaults to `anthropic`. */
  provider?: Provider;
  chatgptAccountId?: string | null;
  planTier?: string | null;
  email?: string | null;
  label: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

export function createAccount(input: NewAccount): Account {
  const id = randomUUID();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO accounts
        (id, provider, label, chatgpt_account_id, plan_tier, email,
         access_token, refresh_token, access_expires_at, state,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      id,
      input.provider ?? "anthropic",
      input.label,
      input.chatgptAccountId ?? null,
      input.planTier ?? null,
      input.email ?? null,
      input.accessToken,
      input.refreshToken,
      input.accessExpiresAt,
      ts,
      ts,
    );
  return getAccount(id)!;
}

export function deleteAccount(id: string): void {
  deletePinsForAccount(id);
  getDb().prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

export function setLabel(id: string, label: string): void {
  getDb()
    .prepare("UPDATE accounts SET label = ?, updated_at = ? WHERE id = ?")
    .run(label, now(), id);
}

/**
 * Sets the account's selection weight. `null` clears the override so the
 * plan-derived default applies again.
 */
export function setWeight(id: string, weight: number | null): void {
  getDb()
    .prepare("UPDATE accounts SET weight = ?, updated_at = ? WHERE id = ?")
    .run(weight, now(), id);
}

/** Stores freshly issued tokens (login or refresh). */
export function setTokens(
  id: string,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: number,
  chatgptAccountId?: string,
): void {
  getDb()
    .prepare(
      `UPDATE accounts
       SET access_token = ?, refresh_token = ?, access_expires_at = ?,
           chatgpt_account_id = COALESCE(?, chatgpt_account_id),
           state = 'active', cooldown_until = NULL, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      accessToken,
      refreshToken,
      accessExpiresAt,
      chatgptAccountId ?? null,
      now(),
      id,
    );
}

/** Writes the profile fields fetched after a successful login/refresh. */
export function setProfile(id: string, profile: AccountProfile): void {
  getDb()
    .prepare(
      `UPDATE accounts SET
         email = ?, org_name = ?, organization_type = ?, rate_limit_tier = ?,
         seat_tier = ?, subscription_status = ?, has_extra_usage_enabled = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      profile.email,
      profile.organizationName,
      profile.organizationType,
      profile.rateLimitTier,
      profile.seatTier,
      profile.subscriptionStatus,
      profile.hasExtraUsageEnabled === null
        ? null
        : profile.hasExtraUsageEnabled
          ? 1
          : 0,
      now(),
      id,
    );
}

export function setState(
  id: string,
  state: AccountState,
  opts: { error?: string | null } = {},
): void {
  getDb()
    .prepare(
      `UPDATE accounts
       SET state = ?, last_error = ?, cooldown_until = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(state, opts.error ?? null, now(), id);
}

/** Puts an account in cooldown until `until` (epoch ms). */
export function setCooldown(id: string, until: number, reason?: string): void {
  getDb()
    .prepare(
      `UPDATE accounts
       SET state = 'cooling', cooldown_until = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(until, reason ?? null, now(), id);
}

export function markError(id: string, reason: string): void {
  getDb()
    .prepare(
      `UPDATE accounts
       SET state = 'error', last_error = ?, cooldown_until = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(reason, now(), id);
}

export function touchSelected(id: string): void {
  getDb()
    .prepare("UPDATE accounts SET last_selected_at = ? WHERE id = ?")
    .run(now(), id);
}

/** Flips any expired cooldowns back to `active`. Called before selection. */
export function reapCooldowns(): void {
  getDb()
    .prepare(
      `UPDATE accounts
       SET state = 'active', cooldown_until = NULL, updated_at = ?
       WHERE state = 'cooling' AND cooldown_until IS NOT NULL AND cooldown_until <= ?`,
    )
    .run(now(), now());
}

/**
 * Eligible accounts for `provider`, active first and then least-recently-
 * selected, excluding any ids already tried on this request.
 */
export function eligibleAccounts(
  provider: Provider,
  excludeIds: string[] = [],
): Account[] {
  reapCooldowns();
  const rows = getDb()
    .prepare(
      `SELECT * FROM accounts
       WHERE state = 'active' AND provider = ?
       ORDER BY COALESCE(last_selected_at, 0) ASC, created_at ASC`,
    )
    .all(provider) as unknown as AccountRow[];
  const excluded = new Set(excludeIds);
  return rows.map(toAccount).filter((a) => !excluded.has(a.id));
}
