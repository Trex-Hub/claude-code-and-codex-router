import { describe, expect, it } from "vitest";
import {
  createAccount,
  eligibleAccounts,
  publicAccount,
  setCooldown,
  setState,
  touchSelected,
  type Provider,
} from "@/lib/accounts";

function mk(label: string, provider: Provider = "anthropic") {
  return createAccount({
    provider,
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
    const all = eligibleAccounts("anthropic");
    expect(all.length).toBeGreaterThanOrEqual(2);

    const remaining = eligibleAccounts("anthropic", [a.id]);
    expect(remaining.map((x) => x.id)).not.toContain(a.id);
    expect(remaining.map((x) => x.id)).toContain(b.id);
  });

  it("orders active accounts by least-recently-selected", () => {
    const a = mk("a");
    const b = mk("b");
    touchSelected(a.id);

    const ordered = eligibleAccounts("anthropic", [b.id]);
    // `a` was just selected, so it should not be first among the rest.
    expect(ordered[0]?.id).not.toBe(a.id);
  });

  it("reaps an expired cooldown back to active", () => {
    const a = mk("cooling-a");
    setCooldown(a.id, Date.now() - 1000, "was rate limited");

    const eligible = eligibleAccounts("anthropic");
    expect(eligible.map((x) => x.id)).toContain(a.id);
  });

  it("does not select a cooling account before its cooldown expires", () => {
    const a = mk("cooling-b");
    setCooldown(a.id, Date.now() + 60_000, "rate limited");

    const eligible = eligibleAccounts("anthropic", [a.id]);
    expect(eligible.map((x) => x.id)).not.toContain(a.id);
  });

  it("excludes disabled and errored accounts", () => {
    const disabled = mk("disabled");
    const errored = mk("errored");
    setState(disabled.id, "disabled");
    setState(errored.id, "error", { error: "boom" });

    const ids = eligibleAccounts("anthropic").map((x) => x.id);
    expect(ids).not.toContain(disabled.id);
    expect(ids).not.toContain(errored.id);
  });

  it("only returns accounts of the requested provider", () => {
    const ant = mk("ant", "anthropic");
    const codex = mk("codex", "openai-codex");

    const antIds = eligibleAccounts("anthropic").map((x) => x.id);
    const codexIds = eligibleAccounts("openai-codex").map((x) => x.id);
    expect(antIds).toContain(ant.id);
    expect(antIds).not.toContain(codex.id);
    expect(codexIds).toContain(codex.id);
    expect(codexIds).not.toContain(ant.id);
  });

  it("defaults to anthropic and stores the chatgpt account id", () => {
    const plain = mk("plain");
    expect(plain.provider).toBe("anthropic");
    expect(plain.chatgptAccountId).toBeNull();

    const codex = createAccount({
      provider: "openai-codex",
      label: "c",
      chatgptAccountId: "acct_123",
      accessToken: "a",
      refreshToken: "r",
      accessExpiresAt: Date.now() + 3_600_000,
    });
    expect(codex.chatgptAccountId).toBe("acct_123");
    expect(publicAccount(codex).provider).toBe("openai-codex");
  });
});
