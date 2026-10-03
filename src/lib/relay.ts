import {
  eligibleAccounts,
  setCooldown,
  touchSelected,
  type Account,
} from "./accounts";
import { env } from "./env";
import { ensureFreshToken } from "./refresh";
import { shapeAnthropicOAuthPayload } from "./shaping/request-shaping";
import { resolveClaudeCodeVersion } from "./shaping/claude-code-version";
import { recordUsage, type UsageInput } from "./usage";
import { newVersionSync } from "./version-sync";

const OAUTH_BETA = "oauth-2025-04-20";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const MAX_ATTEMPTS = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

interface CapturedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

const EMPTY_USAGE: CapturedUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Retryable upstream statuses: rate limits and server errors. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_COOLDOWN_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return DEFAULT_COOLDOWN_MS;
}

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

/** Consumes an SSE stream, accumulating token usage from the Anthropic events. */
async function usageFromSse(stream: ReadableStream<Uint8Array>): Promise<CapturedUsage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let captured: CapturedUsage = { ...EMPTY_USAGE };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const usage =
          event.type === "message_start"
            ? ((event.message as { usage?: Record<string, unknown> } | undefined)
                ?.usage ?? undefined)
            : (event.usage as Record<string, unknown> | undefined);
        if (usage) {
          captured = { ...captured, ...usageFromJson({ usage }) };
        }
      }
    }
  } catch {
    // A truncated stream still yields whatever usage we captured.
  } finally {
    reader.releaseLock();
  }
  return captured;
}

/** Streams the upstream response to the client and records usage when done. */
function streamAndRecord(
  response: Response,
  base: Omit<UsageInput, keyof CapturedUsage>,
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  const headers = new Headers(response.headers);
  // Drop framing/encoding headers: Node's fetch transparently decompresses the
  // body, so a forwarded content-length (compressed size) would not match the
  // bytes we send, and the client would cut the response early ("terminated").
  // We re-frame the stream ourselves.
  for (const h of [
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
  ]) {
    headers.delete(h);
  }

  if (!response.body) {
    recordUsage({ ...base, ...EMPTY_USAGE });
    return new Response(null, { status: response.status, headers });
  }

  const [toClient, toParser] = response.body.tee();

  if (contentType.includes("text/event-stream")) {
    void usageFromSse(toParser)
      .then((usage) => recordUsage({ ...base, ...usage }))
      .catch(() => recordUsage({ ...base, ...EMPTY_USAGE }));
  } else {
    // Non-streaming JSON: read usage from the parsed body.
    void new Response(toParser)
      .json()
      .then((body) => recordUsage({ ...base, ...usageFromJson(body) }))
      .catch(() => recordUsage({ ...base, ...EMPTY_USAGE }));
  }

  return new Response(toClient, { status: response.status, headers });
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

  const tried: string[] = [];
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = eligibleAccounts(tried);
    const account: Account | undefined = candidates[0];
    if (!account) break;

    tried.push(account.id);
    touchSelected(account.id);

    let fresh: Account;
    try {
      fresh = await ensureFreshToken(account);
    } catch {
      // Account already marked `error`; try the next one.
      lastResponse = undefined;
      continue;
    }

    const started = Date.now();
    const versionSync = newVersionSync();
    versionSync.recordRequest(shaped);

    let response: Response;
    try {
      response = await versionSync.fetch(
        `${env.anthropicApiBase()}${upstreamPath}${search}`,
        {
          method: "POST",
          headers: upstreamHeaders(fresh.accessToken, req.headers),
          body: shapedText,
          signal: req.signal,
        },
      );
    } catch (error) {
      lastResponse = undefined;
      if (tried.length >= MAX_ATTEMPTS) {
        return jsonError(502, `upstream request failed: ${(error as Error).message}`);
      }
      continue;
    }

    if (isRetryable(response.status)) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      if (response.status === 429) {
        setCooldown(fresh.id, Date.now() + retryAfterMs, "rate limited");
      }
      // More accounts to try?
      if (eligibleAccounts(tried).length > 0) {
        await response.body?.cancel();
        continue;
      }
      lastResponse = response;
      break;
    }

    return streamAndRecord(response, {
      accountId: fresh.id,
      relayKeyId,
      model,
      requestId: response.headers.get("request-id"),
      status: response.status,
      latencyMs: Date.now() - started,
    });
  }

  if (lastResponse) {
    return streamAndRecord(lastResponse, {
      accountId: tried[tried.length - 1] ?? "",
      relayKeyId,
      model,
      requestId: lastResponse.headers.get("request-id"),
      status: lastResponse.status,
      latencyMs: null,
    });
  }

  return jsonError(503, "no eligible accounts available");
}
