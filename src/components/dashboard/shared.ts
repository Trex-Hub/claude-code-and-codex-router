export type ProviderId = "anthropic" | "openai-codex";

// Per-provider UI text; redirect URLs mirror src/lib/oauth/{anthropic,openai-codex}.ts.
export const PROVIDERS: Record<
  ProviderId,
  { name: string; defaultLabel: string; redirect: string }
> = {
  anthropic: {
    name: "Claude",
    defaultLabel: "Claude account",
    redirect: "http://localhost:53692/callback",
  },
  "openai-codex": {
    name: "ChatGPT",
    defaultLabel: "Codex account",
    redirect: "http://localhost:1455/auth/callback",
  },
};

export interface AccountView {
  id: string;
  provider: ProviderId;
  label: string;
  email: string | null;
  organizationType: string | null;
  planTier: string | null;
  rateLimitTier: string | null;
  subscriptionStatus: string | null;
  hasExtraUsageEnabled: boolean | null;
  state: string;
  cooldownUntil: number | null;
  lastError: string | null;
  lastSelectedAt: number | null;
}

/**
 * Human name for an account's subscription plan.
 *
 * The two providers report this in different fields and neither is a plain
 * label, so it is derived here rather than stored:
 *
 * - Anthropic: `organizationType` is authoritative (`claude_pro`, `claude_max`),
 *   and `rateLimitTier` only adds the Max multiplier (`..._max_5x`, `..._max_20x`).
 *   Note the tier slug is not always trustworthy — Anthropic has shipped Pro
 *   accounts a free-tier `default_claude_ai` slug — so the multiplier is only
 *   applied when it is unambiguous, and the name never depends on it.
 * - Codex: `planTier` from the access-token claims (`plus`, `pro`).
 */
export function planLabel(a: {
  provider: ProviderId;
  organizationType?: string | null;
  planTier?: string | null;
  rateLimitTier?: string | null;
}): string | null {
  const multiplier = a.rateLimitTier?.match(/_max_(\d+x)/)?.[1];

  if (a.provider === "openai-codex") {
    if (!a.planTier) return null;
    const name = a.planTier.charAt(0).toUpperCase() + a.planTier.slice(1).toLowerCase();
    return `ChatGPT ${name}`;
  }

  // Anthropic: prefer organizationType, fall back to the tier slug.
  const org = a.organizationType ?? a.rateLimitTier ?? null;
  if (!org) return null;

  const isPro = org.includes("claude_pro") || org === "default_claude_pro";
  const isMax = org.includes("claude_max") || org.includes("max_5x") || org.includes("max_20x");
  const base = isMax ? "Claude Max" : isPro ? "Claude Pro" : null;
  if (!base) {
    // Unknown slug (e.g. free tier): title-case it rather than invent a plan.
    return org.replace(/^default_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return multiplier ? `${base} ${multiplier}` : base;
}

export interface KeyView {
  id: string;
  key: string;
  label: string | null;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

export interface UsageRow {
  accountId: string;
  requests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  lastUsedAt: number | null;
}

export interface UsageEvent {
  id: number;
  accountId: string;
  model: string | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  status: number | null;
  latencyMs: number | null;
  createdAt: number;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  return body;
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const fmtInt = (n: number | null | undefined) => nf.format(n ?? 0);
export const fmtCompact = (n: number | null | undefined) => cf.format(n ?? 0);

/**
 * True input volume: fresh input plus both cache buckets. The relay always
 * stores these three as disjoint counts (see `src/lib/usage.ts`), so this is
 * the real number of tokens the model read. `cacheReadTokens` is the subset
 * of that which came from a cache hit.
 */
export function totalInput(row: {
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}): number {
  return (row.inputTokens ?? 0) + (row.cacheReadTokens ?? 0) + (row.cacheWriteTokens ?? 0);
}

export function fmtAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtUntil(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((ms - now) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.round(h / 24)}d`;
}

export const fmtFull = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "—");

export function maskKey(key: string): string {
  return key.length <= 12 ? "•".repeat(key.length) : `${key.slice(0, 8)}${"•".repeat(12)}${key.slice(-4)}`;
}
