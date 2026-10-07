import type { Provider } from "./accounts";

/** The plan fields weight derivation reads; both `Account` and the dashboard
 * `AccountView` satisfy this structurally. */
export interface WeightFields {
  provider: Provider | "anthropic" | "openai-codex";
  organizationType?: string | null;
  planTier?: string | null;
  rateLimitTier?: string | null;
}

/**
 * Relative share of new conversations a seat should attract, derived from its
 * plan. A Max 5x seat is entitled to roughly 5x the capacity of a Pro seat, so
 * it should take roughly 5x the share of fresh sessions.
 *
 * This is the default only; an explicit per-account `weight` overrides it.
 * Values are ratios, not percentages — a pool of {5, 1} splits 5:1, and a pool
 * of {5, 5, 1} splits 5:5:1.
 */
export function planWeight(a: WeightFields): number {
  if (a.provider === "openai-codex") {
    // Plus and Pro are the two Codex tiers; Pro is the heavier seat.
    return a.planTier?.toLowerCase() === "pro" ? 5 : 1;
  }

  // Anthropic: the tier slug carries the Max multiplier when present.
  const multiplier = a.rateLimitTier?.match(/_max_(\d+x)/)?.[1];
  if (multiplier) return Number.parseInt(multiplier, 10);

  const org = a.organizationType ?? a.rateLimitTier ?? "";
  if (org.includes("claude_max")) return 5;
  return 1;
}

/** Effective weight for a seat: explicit override, else plan-derived. */
export function effectiveWeight(a: WeightFields & { weight?: number | null }): number {
  return a.weight && a.weight > 0 ? a.weight : planWeight(a);
}
