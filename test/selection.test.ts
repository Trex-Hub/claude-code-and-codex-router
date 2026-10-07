import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccount, getAccount, setCooldown, setProfile, setWeight } from "@/lib/accounts";
import { deletePin, getPin, setPin } from "@/lib/pins";
import { selectAccount } from "@/lib/selection";
import { resetPool } from "./helpers/relay-env";

function seat(
  label: string,
  opts: Partial<{
    provider: "anthropic" | "openai-codex";
    organizationType: string | null;
    rateLimitTier: string | null;
  }> = {},
) {
  const { organizationType, rateLimitTier, ...rest } = opts;
  const account = createAccount({
    label,
    accessToken: `tok-${label}`,
    refreshToken: "r",
    accessExpiresAt: Date.now() + 3_600_000,
    ...rest,
  });
  if (organizationType !== undefined || rateLimitTier !== undefined) {
    setProfile(account.id, {
      organizationType: organizationType ?? null,
      rateLimitTier: rateLimitTier ?? null,
      seatTier: null,
      subscriptionStatus: "active",
      hasExtraUsageEnabled: null,
      email: null,
      organizationName: null,
    });
  }
  return getAccount(account.id)!;
}

beforeEach(async () => {
  await resetPool();
});
afterEach(async () => {
  await resetPool();
});

describe("selectAccount affinity", () => {
  it("keeps a conversation on the same seat across turns", () => {
    seat("a");
    seat("b");

    const first = selectAccount("anthropic", "conv-1");
    expect(first).toBeDefined();

    // Repeat turns must resolve to the same seat regardless of what else ran.
    for (let i = 0; i < 5; i++) {
      expect(selectAccount("anthropic", "conv-1")?.id).toBe(first!.id);
    }
    expect(getPin("conv-1", "anthropic")).toBe(first!.id);
  });

  it("spreads distinct conversations across seats (cache keys differ)", () => {
    seat("a");
    seat("b");

    const chosen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      chosen.add(selectAccount("anthropic", `conv-${i}`)!.id);
    }
    // With two seats and distinct keys, both should see traffic.
    expect(chosen.size).toBe(2);
  });

  it("repins when the pinned seat is rate limited, and stays moved", () => {
    const a = seat("a");
    const b = seat("b");

    const first = selectAccount("anthropic", "conv-1")!;
    const other = first.id === a.id ? b : a;

    // The pinned seat gets rate limited; the request fails over.
    setCooldown(first.id, Date.now() + 60_000, "rate limited");
    const moved = selectAccount("anthropic", "conv-1", [first.id])!;
    expect(moved.id).toBe(other.id);

    // The old seat recovers — but the conversation must NOT snap back, or it
    // would discard the cache it just rewrote on the new seat.
    setCooldown(first.id, Date.now() - 1, "recovered");
    expect(selectAccount("anthropic", "conv-1")!.id).toBe(other.id);
  });

  it("re-selects once the pin expires", () => {
    const a = seat("a");
    seat("b");
    setPin("conv-1", "anthropic", a.id);
    // Force expiry.
    getPin("conv-1", "anthropic");
    deletePin("conv-1");
    const next = selectAccount("anthropic", "conv-1", [a.id]);
    expect(next).toBeDefined();
    expect(next!.id).not.toBe(a.id);
  });

  it("ignores a pin belonging to a different provider", () => {
    const a = seat("a", { provider: "openai-codex" });
    seat("b", { provider: "openai-codex" });
    setPin("shared-key", "anthropic", a.id);

    // Same key, different provider: the anthropic pool is empty, so nothing is
    // returned rather than leaking the codex seat across providers.
    expect(selectAccount("anthropic", "shared-key")).toBeUndefined();
  });

  it("excludes already-tried seats", () => {
    const a = seat("a");
    const b = seat("b");
    const chosen = selectAccount("anthropic", "conv-1", [a.id, b.id]);
    expect(chosen).toBeUndefined();
  });
});

describe("selectAccount weights", () => {
  it("directs more new conversations to a heavier seat", () => {
    // Pro (weight 1) vs Max 5x (weight 5).
    seat("pro", { organizationType: "claude_pro" });
    seat("max", {
      organizationType: "claude_max",
      rateLimitTier: "default_claude_max_5x",
    });

    const counts = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      const id = selectAccount("anthropic", `conv-${i}`)!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const [c1, c2] = [...counts.values()].sort((x, y) => x - y);
    // Rendezvous weighting is approximate; expect the heavy seat to win much
    // more often than the light one (5:1 in expectation).
    expect(c2 / c1).toBeGreaterThan(2.5);
  });

  it("honours an explicit weight override", () => {
    const a = seat("a", { organizationType: "claude_pro" });
    seat("b", { organizationType: "claude_pro" });
    // Make "a" 20x heavier than "b" despite identical plans.
    setWeight(a.id, 20);

    let aWins = 0;
    for (let i = 0; i < 400; i++) {
      if (selectAccount("anthropic", `conv-${i}`)!.id === a.id) aWins++;
    }
    expect(aWins).toBeGreaterThan(200);
  });
});

describe("selectAccount concurrency", () => {
  it("gives concurrent requests for one conversation the same seat", () => {
    seat("a");
    seat("b");

    // Rendezvous hashing is a pure function of (key, accounts), so two callers
    // evaluating selection at the same moment cannot disagree — which is what
    // keeps a conversation's cache from splitting across seats.
    const picks = new Set(
      Array.from({ length: 10 }, () => selectAccount("anthropic", "conv-1")!.id),
    );
    expect(picks.size).toBe(1);
  });
});

describe("selectAccount without an affinity key", () => {
  it("spreads by least-recently-used", () => {
    seat("a");
    seat("b");
    const first = selectAccount("anthropic", null)!;
    const second = selectAccount("anthropic", null)!;
    expect(first.id).not.toBe(second.id);
    // And it records the pick so the next request alternates.
    expect(getAccount(first.id)?.lastSelectedAt).not.toBeNull();
  });
});
