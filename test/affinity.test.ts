import { describe, expect, it } from "vitest";
import { deriveAffinityKey } from "@/lib/affinity";

const base = {
  system: "you are a helpful assistant",
  tools: [{ name: "read" }],
  messages: [{ role: "user", content: "first question" }],
};

describe("deriveAffinityKey", () => {
  it("is stable as the conversation grows", () => {
    const first = deriveAffinityKey(base);
    const later = deriveAffinityKey({
      ...base,
      messages: [
        ...base.messages,
        { role: "assistant", content: "hi" },
        { role: "user", content: "follow up" },
      ],
    });
    // Turn 2+ must resolve to the same seat as turn 1.
    expect(later).toBe(first);
  });

  it("differs between conversations", () => {
    const a = deriveAffinityKey(base);
    const b = deriveAffinityKey({
      ...base,
      messages: [{ role: "user", content: "something else" }],
    });
    expect(a).not.toBe(b);
  });

  it("differs when the system prompt or tools change", () => {
    const baseKey = deriveAffinityKey(base);
    expect(deriveAffinityKey({ ...base, system: "different" })).not.toBe(baseKey);
    expect(deriveAffinityKey({ ...base, tools: [{ name: "write" }] })).not.toBe(baseKey);
  });

  it("handles block content and returns null without a user message", () => {
    expect(
      deriveAffinityKey({
        ...base,
        messages: [{ role: "user", content: [{ type: "text", text: "first question" }] }],
      }),
    ).toBe(deriveAffinityKey(base));

    expect(
      deriveAffinityKey({ ...base, messages: [{ role: "assistant", content: "x" }] }),
    ).toBeNull();
  });
});
