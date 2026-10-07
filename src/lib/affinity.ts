import { createHash } from "node:crypto";

/**
 * Derives a stable conversation key for an Anthropic request.
 *
 * Anthropic sends no session identifier, so the key is derived from what stays
 * constant across the turns of one conversation while differing between
 * conversations:
 *
 * - The system prompt alone is wrong: it is identical for every conversation of
 *   a given client, so every conversation would pin to one seat.
 * - The full message list is wrong: it grows each turn, so the key would change
 *   every request and the pin would never hold.
 * - The first user message is the stable anchor that separates conversations.
 *
 * Combined with the system prompt and tool definitions, two conversations
 * started from the same opening message will collide onto one seat, which is
 * benign — they share a cacheable prefix anyway.
 */
export function deriveAffinityKey(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const req = body as {
    system?: unknown;
    tools?: unknown;
    messages?: unknown;
  };

  const firstUser = firstUserText(req.messages);
  if (!firstUser) return null;

  const basis = JSON.stringify({
    system: req.system ?? null,
    tools: req.tools ?? null,
    firstUser,
  });
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

/** Text of the first user message, or null when there is none. */
function firstUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== "user") continue;
    return textOf(content);
  }
  return null;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content || null;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
