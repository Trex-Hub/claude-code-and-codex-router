import { describe, expect, it } from "vitest";
import { shapeAnthropicOAuthPayload } from "@/lib/shaping/request-shaping";

const PI_PREAMBLE =
  "You are an expert coding assistant operating inside pi, a coding agent harness.";

function piPayload(): Record<string, unknown> {
  return {
    model: "claude-sonnet-5-5",
    stream: true,
    system: [
      {
        type: "text",
        text: `${PI_PREAMBLE}\n\n<tools>some tools</tools>`,
      },
    ],
    messages: [{ role: "user", content: "hello world" }],
  };
}

describe("shapeAnthropicOAuthPayload (vendored)", () => {
  it("prepends the Claude Code billing header", () => {
    const out = shapeAnthropicOAuthPayload(piPayload()) as {
      system: Array<{ text: string }>;
    };
    expect(Array.isArray(out.system)).toBe(true);
    expect(out.system[0].text).toContain("x-anthropic-billing-header:");
    expect(out.system[0].text).toContain("cc_entrypoint=sdk-cli;");
    expect(out.system[0].text).toMatch(/cc_version=\d+\.\d+\.\d+/);
  });

  it("is idempotent", () => {
    const once = shapeAnthropicOAuthPayload(piPayload());
    const twice = shapeAnthropicOAuthPayload(once);
    expect(twice).toEqual(once);
  });

  it("leaves non-anthropic payloads untouched", () => {
    const payload = { foo: "bar" };
    expect(shapeAnthropicOAuthPayload(payload)).toBe(payload);
  });
});
