import { env } from "./env";
import {
  jsonError,
  relayWithFailover,
  EMPTY_USAGE,
  type CapturedUsage,
  type RelayAdapter,
} from "./relay-core";
import { shapeAnthropicOAuthPayload } from "./shaping/request-shaping";
import { deriveAffinityKey } from "./affinity";
import { resolveClaudeCodeVersion } from "./shaping/claude-code-version";
import { newVersionSync } from "./version-sync";

const OAUTH_BETA = "oauth-2025-04-20";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/** Builds the outgoing headers to Anthropic for one account. */
function upstreamHeaders(
  accessToken: string,
  client: Headers,
): Record<string, string> {
  // Preserve any client beta flags, always including the OAuth beta.
  const betas = new Set(
    (client.get("anthropic-beta") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  betas.add(OAUTH_BETA);

  // A `claude-cli/<version>` user-agent lets the version sync adopt Pi's
  // reported version; otherwise we present the bundled one.
  const clientUa = client.get("user-agent") ?? "";
  const userAgent = clientUa.includes("claude-cli/")
    ? clientUa
    : `claude-cli/${resolveClaudeCodeVersion()}`;

  return {
    "content-type": "application/json",
    accept: client.get("accept") ?? "application/json",
    authorization: `Bearer ${accessToken}`,
    "anthropic-version":
      client.get("anthropic-version") ?? DEFAULT_ANTHROPIC_VERSION,
    "anthropic-beta": [...betas].join(","),
    "user-agent": userAgent,
  };
}

/** Extracts token usage from a JSON (non-streaming) response body. */
function usageFromJson(body: unknown): CapturedUsage {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage) return EMPTY_USAGE;
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    inputTokens: n(usage.input_tokens),
    outputTokens: n(usage.output_tokens),
    cacheReadTokens: n(usage.cache_read_input_tokens),
    cacheWriteTokens: n(usage.cache_creation_input_tokens),
  };
}

/** Usage from `message_start` / `message_delta` SSE events. */
function usageFromEvent(
  event: Record<string, unknown>,
): CapturedUsage | undefined {
  const usage =
    event.type === "message_start"
      ? ((event.message as { usage?: Record<string, unknown> } | undefined)
          ?.usage ?? undefined)
      : (event.usage as Record<string, unknown> | undefined);
  return usage ? usageFromJson({ usage }) : undefined;
}

/**
 * Handles one `/v1/messages` relay request: shapes the payload, picks an
 * account, refreshes its token, forwards, and fails over on rate limits.
 */
export async function handleMessages(
  req: Request,
  relayKeyId: string | null,
  upstreamPath = "/v1/messages",
): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = JSON.parse(await req.text());
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const model =
    typeof (rawBody as { model?: unknown }).model === "string"
      ? ((rawBody as { model: string }).model)
      : null;

  const shaped = shapeAnthropicOAuthPayload(rawBody);
  const shapedText = JSON.stringify(shaped);

  // Preserve the client's query string (e.g. `?beta=true`) on the upstream call.
  const search = new URL(req.url).search;

  const adapter: RelayAdapter = {
    provider: "anthropic",
    model,
    // Anthropic carries no session id; derive one so repeat turns of a
    // conversation reuse the same seat and its warm prompt cache.
    affinityKey: deriveAffinityKey(rawBody),
    prepare(account) {
      const versionSync = newVersionSync();
      versionSync.recordRequest(shaped);
      return {
        url: `${env.anthropicApiBase()}${upstreamPath}${search}`,
        headers: upstreamHeaders(account.accessToken, req.headers),
        body: shapedText,
        fetch: versionSync.fetch,
      };
    },
    usageFromJson,
    usageFromEvent,
    requestId: (res) => res.headers.get("request-id"),
  };

  return relayWithFailover(adapter, { relayKeyId, signal: req.signal });
}
