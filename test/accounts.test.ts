import { describe, expect, it } from "vitest";
import {
  createAccount,
  eligibleAccounts,
  setCooldown,
  setState,
  touchSelected,
} from "@/lib/accounts";

function mk(label: string) {
  return createAccount({
    label,
    accessToken: "sk-ant-oat-access",
    refreshToken: "refresh",
    accessExpiresAt: Date.now() + 3_600_000,
  });
}

describe("account selection", () => {
  it("excludes already-tried ids", () => {
    const a = mk("a");
    const b = mk("b");
    const all = eligibleAccounts();
    expect(all.length).toBeGreaterThanOrEqual(2);

    const remaining = eligibleAccounts([a.id]);
    expect(remaining.map((x) => x.id)).not.toContain(a.id);
    expect(remaining.map((x) => x.id)).toContain(b.id);
  });

  it("orders active accounts by least-recently-selected", () => {
    const a = mk("a");
    const b = mk("b");
    touchSelected(a.id);

    const ordered = eligibleAccounts([b.id]);
    // `a` was just selected, so it should not be first among the rest.
    expect(ordered[0]?.id).not.toBe(a.id);
  });

  it("reaps an expired cooldown back to active", () => {
    const a = mk("cooling-a");
    setCooldown(a.id, Date.now() - 1000, "was rate limited");

    const eligible = eligibleAccounts();
    expect(eligible.map((x) => x.id)).toContain(a.id);
  });

  it("does not select a cooling account before its cooldown expires", () => {
    const a = mk("cooling-b");
    setCooldown(a.id, Date.now() + 60_000, "rate limited");

    const eligible = eligibleAccounts([a.id]);
    expect(eligible.map((x) => x.id)).not.toContain(a.id);
  });

  it("excludes disabled and errored accounts", () => {
    const disabled = mk("disabled");
    const errored = mk("errored");
    setState(disabled.id, "disabled");
    setState(errored.id, "error", { error: "boom" });

    const ids = eligibleAccounts().map((x) => x.id);
    expect(ids).not.toContain(disabled.id);
    expect(ids).not.toContain(errored.id);
  });
});
