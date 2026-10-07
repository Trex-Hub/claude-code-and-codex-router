import os from "node:os";
import { env } from "./env";
import { readClaims } from "./oauth/openai-codex";
import {
  EMPTY_USAGE,
  jsonError,
  parseRetryAfterMs,
  relayWithFailover,
  type CapturedUsage,
  type RelayAdapter,
} from "./relay-core";

const DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";

/**
 * Fields the ChatGPT Codex backend accepts, mirroring the body pi-ai's
 * `openai-codex-responses` builds. Anything else the client sends (e.g.
 * `max_output_tokens`, `prompt_cache_retention`, `prompt_cache_options` from
 * the plain `openai-responses` client) is dropped rather than risk a 400.
 */
const ALLOWED_FIELDS = [
  "model",
  "instructions",
  "input",
  "text",
  "include",
  "prompt_cache_key",
  "tool_choice",
  "parallel_tool_calls",
  "temperature",
  "service_tier",
  "tools",
  "reasoning",
] as const;

type Json = Record<string, unknown>;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof (part as Json)?.text === "string" ? ((part as Json).text as string) : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Reshapes a Responses API body for the Codex backend: allowlisted fields
 * only, `store:false` / `stream:true` forced, and a mandatory `instructions`.
 * The plain OpenAI client sends the system prompt as the first `developer`
 * message in `input`; Codex wants it in `instructions`, so it is hoisted.
 */
export function normalizeCodexBody(raw: Json): Json {
  const body: Json = {};
  for (const key of ALLOWED_FIELDS) {
    if (raw[key] !== undefined) body[key] = raw[key];
  }

  if (typeof body.input === "string") {
    body.input = [
      { role: "user", content: [{ type: "input_text", text: body.input }] },
    ];
  }

  let instructions =
    typeof body.instructions === "string" ? body.instructions.trim() : "";
  if (!instructions && Array.isArray(body.input)) {
    const [first, ...rest] = body.input as Json[];
    if (first && (first.role === "developer" || first.role === "system")) {
      instructions = textOf(first.content).trim();
      body.input = rest;
    }
  }
  body.instructions = instructions || DEFAULT_INSTRUCTIONS;

  body.store = false;
  body.stream = true;
  return body;
}

function upstreamHeaders(
  accessToken: string,
  chatgptAccountId: string | null,
  sessionId: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    originator: "pi",
    "user-agent": `pi (${os.platform()} ${os.release()}; ${os.arch()})`,
    "openai-beta": "responses=experimental",
    accept: "text/event-stream",
    "content-type": "application/json",
  };
  const accountId = chatgptAccountId ?? readClaims(accessToken).chatgptAccountId;
  if (accountId) headers["chatgpt-account-id"] = accountId;
  if (sessionId) {
    headers["session-id"] = sessionId;
    headers["x-client-request-id"] = sessionId;
  }
  return headers;
}

/** Usage from a `response.completed` / `done` / `incomplete` event. */
function usageFromEvent(event: Json): CapturedUsage | undefined {
  if (
    event.type !== "response.completed" &&
    event.type !== "response.done" &&
    event.type !== "response.incomplete"
  ) {
    return undefined;
  }
  return usageFromJson(event.response);
}

function usageFromJson(body: unknown): CapturedUsage {
  const usage = (body as { usage?: Json } | null)?.usage;
  if (!usage) return EMPTY_USAGE;
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const input = n(usage.input_tokens);
  const cached = n((usage.input_tokens_details as Json | undefined)?.cached_tokens);
  return {
    // OpenAI counts cached tokens inside input_tokens; Anthropic does not.
    // Store them split so the dashboard means the same thing for both.
    inputTokens: input === null ? null : input - (cached ?? 0),
    outputTokens: n(usage.output_tokens),
    cacheReadTokens: cached,
    cacheWriteTokens: null,
  };
}

/**
 * ChatGPT reports an exhausted plan as a 429 with `error.resets_at` (epoch
 * seconds) or `error.resets_in_seconds`; cool the account down until then
 * rather than the 60 s default.
 */
async function retryAfterMs(response: Response): Promise<number> {
  try {
    const parsed = JSON.parse(await response.clone().text()) as {
      error?: { resets_at?: unknown; resets_in_seconds?: unknown };
    };
    const { resets_at, resets_in_seconds } = parsed.error ?? {};
    if (typeof resets_at === "number") {
      return Math.max(0, resets_at * 1000 - Date.now());
    }
    if (typeof resets_in_seconds === "number") {
      return Math.max(0, resets_in_seconds * 1000);
    }
  } catch {
    // not JSON; fall through
  }
  return parseRetryAfterMs(response.headers.get("retry-after"));
}

/**
 * Handles one `/v1/responses` relay request against the pooled ChatGPT Codex
 * accounts: normalizes the body, picks an account, refreshes its token,
 * forwards to the Codex backend and fails over on rate limits.
 */
export async function handleResponses(
  req: Request,
  relayKeyId: string | null,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return jsonError(400, "request body must be a JSON object");
  }

  // The Codex backend only streams; fail loudly instead of answering a
  // non-streaming client with SSE it can't parse.
  if ((raw as Json).stream === false) {
    return jsonError(400, "stream:false is not supported; this endpoint always streams");
  }

    const body = normalizeCodexBody(raw as Json);
  const bodyText = JSON.stringify(body);
  const sessionId =
    typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : null;

  const adapter: RelayAdapter = {
    provider: "openai-codex",
    model: typeof body.model === "string" ? body.model : null,
    failoverOn401: true,
    alwaysStreams: true,
    prepare: (account) => ({
      url: `${env.codexApiBase()}/codex/responses`,
      headers: upstreamHeaders(
        account.accessToken,
        account.chatgptAccountId,
        sessionId,
      ),
      body: bodyText,
    }),
    usageFromJson,
    usageFromEvent,
    requestId: (res) => res.headers.get("x-request-id"),
    retryAfterMs,
  };

  return relayWithFailover(adapter, { relayKeyId, signal: req.signal });
}
