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
  planTier: string | null;
  rateLimitTier: string | null;
  subscriptionStatus: string | null;
  hasExtraUsageEnabled: boolean | null;
  state: string;
  cooldownUntil: number | null;
  lastError: string | null;
  lastSelectedAt: number | null;
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
  outputTokens: number;
  lastUsedAt: number | null;
}

export interface UsageEvent {
  id: number;
  accountId: string;
  model: string | null;
  inputTokens: number | null;
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
