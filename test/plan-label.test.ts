import { describe, expect, it } from "vitest";
import { planLabel } from "@/components/dashboard/shared";

/**
 * The Plan column used to show whatever raw slug the provider returned, or
 * nothing at all for Anthropic (whose plan lives in `organization_type`, a
 * column the login flow never filled). These cases pin the derived label.
 */
describe("planLabel", () => {
  it("names Anthropic plans from organization_type", () => {
    expect(planLabel({ provider: "anthropic", organizationType: "claude_pro" })).toBe(
      "Claude Pro",
    );
    expect(planLabel({ provider: "anthropic", organizationType: "claude_max" })).toBe(
      "Claude Max",
    );
  });

  it("adds the Max multiplier from the rate-limit tier", () => {
    expect(
      planLabel({
        provider: "anthropic",
        organizationType: "claude_max",
        rateLimitTier: "default_claude_max_5x",
      }),
    ).toBe("Claude Max 5x");
    expect(
      planLabel({
        provider: "anthropic",
        organizationType: "claude_max",
        rateLimitTier: "default_claude_max_20x",
      }),
    ).toBe("Claude Max 20x");
  });

  it("ignores a Pro account's free-tier tier slug", () => {
    // Anthropic has shipped Pro subscribers "default_claude_ai" (a free-tier
    // slug); the name must still come from organization_type.
    expect(
      planLabel({
        provider: "anthropic",
        organizationType: "claude_pro",
        rateLimitTier: "default_claude_ai",
      }),
    ).toBe("Claude Pro");
  });

  it("falls back to the tier slug when organization_type is missing", () => {
    expect(
      planLabel({ provider: "anthropic", rateLimitTier: "default_claude_max_5x" }),
    ).toBe("Claude Max 5x");
  });

  it("names Codex plans from the JWT plan tier", () => {
    expect(planLabel({ provider: "openai-codex", planTier: "plus" })).toBe(
      "ChatGPT Plus",
    );
    expect(planLabel({ provider: "openai-codex", planTier: "pro" })).toBe(
      "ChatGPT Pro",
    );
  });

  it("returns null rather than guessing when nothing is known", () => {
    expect(planLabel({ provider: "anthropic" })).toBeNull();
    expect(planLabel({ provider: "openai-codex" })).toBeNull();
  });
});
