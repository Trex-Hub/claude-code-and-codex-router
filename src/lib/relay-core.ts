import {
  eligibleAccounts,
  markError,
  setCooldown,
  touchSelected,
  type Account,
  type Provider,
} from "./accounts";
import { ensureFreshToken } from "./refresh";
import { recordUsage, type UsageInput } from "./usage";

const MAX_ATTEMPTS = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

export interface CapturedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export const EMPTY_USAGE: CapturedUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
};

/** One upstream attempt for one account. */
export interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** Overrides the global fetch for this attempt (Anthropic version sync). */
  fetch?: typeof fetch;
}

/** Everything that differs between providers; the failover loop is shared. */
export interface RelayAdapter {
  provider: Provider;
  model: string | null;
  /** Builds the upstream request for an account that already has a fresh token. */
  prepare(account: Account): PreparedRequest;
  /** Usage from a non-streaming JSON response body. */
  usageFromJson(body: unknown): CapturedUsage;
  /** Usage carried by one parsed SSE event, if any. */
  usageFromEvent(event: Record<string, unknown>): CapturedUsage | undefined;
  /**
   * Successful responses are always SSE even if the upstream omits the
   * `content-type` header (the Codex backend does).
   */
  alwaysStreams?: boolean;
  requestId(response: Response): string | null;
  /**
   * On a 401 (after a successful refresh) mark the account `error` and try the
   * next one. Off by default so Anthropic keeps passing 401s through.
   */
  failoverOn401?: boolean;
  /** Cooldown for a 429; defaults to the `Retry-After` header. */
  retryAfterMs?(response: Response): Promise<number>;
}

export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Retryable upstream statuses: rate limits and server errors. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_COOLDOWN_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return DEFAULT_COOLDOWN_MS;
}

/**
 * Merges a later usage report into the running total. Only non-null fields
 * overwrite: Anthropic's `message_delta` carries just `output_tokens`, and
 * must not erase the input/cache counts reported at `message_start`.
 */
function mergeUsage(prev: CapturedUsage, next: CapturedUsage): CapturedUsage {
  return {
    inputTokens: next.inputTokens ?? prev.inputTokens,
    outputTokens: next.outputTokens ?? prev.outputTokens,
    cacheReadTokens: next.cacheReadTokens ?? prev.cacheReadTokens,
    cacheWriteTokens: next.cacheWriteTokens ?? prev.cacheWriteTokens,
  };
}

/** Consumes an SSE stream, accumulating token usage from its events. */
async function usageFromSse(
  stream: ReadableStream<Uint8Array>,
  adapter: RelayAdapter,
): Promise<CapturedUsage> {
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
        const usage = adapter.usageFromEvent(event);
        if (usage) captured = mergeUsage(captured, usage);
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
  adapter: RelayAdapter,
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

  const isSse =
    contentType.includes("text/event-stream") ||
    (adapter.alwaysStreams === true && response.ok);
  if (isSse && !contentType) headers.set("content-type", "text/event-stream");

  const [toClient, toParser] = response.body.tee();

  if (isSse) {
    void usageFromSse(toParser, adapter)
      .then((usage) => recordUsage({ ...base, ...usage }))
      .catch(() => recordUsage({ ...base, ...EMPTY_USAGE }));
  } else {
    // Non-streaming JSON: read usage from the parsed body.
    void new Response(toParser)
      .json()
      .then((body) => recordUsage({ ...base, ...adapter.usageFromJson(body) }))
      .catch(() => recordUsage({ ...base, ...EMPTY_USAGE }));
  }

  return new Response(toClient, { status: response.status, headers });
}

/**
 * Picks an account for `adapter.provider`, refreshes its token, forwards the
 * request and fails over on rate limits / server errors. Failover only applies
 * before the first byte is streamed.
 */
export async function relayWithFailover(
  adapter: RelayAdapter,
  ctx: { relayKeyId: string | null; signal?: AbortSignal },
): Promise<Response> {
  const tried: string[] = [];
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = eligibleAccounts(adapter.provider, tried);
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
    const prepared = adapter.prepare(fresh);

    let response: Response;
    try {
      response = await (prepared.fetch ?? fetch)(prepared.url, {
        method: "POST",
        headers: prepared.headers,
        body: prepared.body,
        signal: ctx.signal,
      });
    } catch (error) {
      lastResponse = undefined;
      if (tried.length >= MAX_ATTEMPTS) {
        return jsonError(502, `upstream request failed: ${(error as Error).message}`);
      }
      continue;
    }

    if (response.status === 401 && adapter.failoverOn401) {
      markError(fresh.id, "upstream rejected the access token (401)");
      if (eligibleAccounts(adapter.provider, tried).length > 0) {
        await response.body?.cancel();
        continue;
      }
      lastResponse = response;
      break;
    }

    if (isRetryable(response.status)) {
      if (response.status === 429) {
        const retryAfterMs = adapter.retryAfterMs
          ? await adapter.retryAfterMs(response)
          : parseRetryAfterMs(response.headers.get("retry-after"));
        setCooldown(fresh.id, Date.now() + retryAfterMs, "rate limited");
      }
      // More accounts to try?
      if (eligibleAccounts(adapter.provider, tried).length > 0) {
        await response.body?.cancel();
        continue;
      }
      lastResponse = response;
      break;
    }

    return streamAndRecord(response, adapter, {
      accountId: fresh.id,
      relayKeyId: ctx.relayKeyId,
      model: adapter.model,
      requestId: adapter.requestId(response),
      status: response.status,
      latencyMs: Date.now() - started,
    });
  }

  if (lastResponse) {
    return streamAndRecord(lastResponse, adapter, {
      accountId: tried[tried.length - 1] ?? "",
      relayKeyId: ctx.relayKeyId,
      model: adapter.model,
      requestId: adapter.requestId(lastResponse),
      status: lastResponse.status,
      latencyMs: null,
    });
  }

  return jsonError(503, "no eligible accounts available");
}
