import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, getAccount } from "@/lib/accounts";
import { handleResponses, normalizeCodexBody } from "@/lib/relay-codex";
import { CODEX_JWT } from "./helpers/codex-jwt";
import { resetPool, sse, waitForUsage } from "./helpers/relay-env";

function mkCodex(label: string, token = CODEX_JWT, accountId = "acct_abc") {
  return createAccount({
    provider: "openai-codex",
    label,
    chatgptAccountId: accountId,
    accessToken: token,
    refreshToken: "r",
    accessExpiresAt: Date.now() + 3_600_000,
  });
}

function request(body: Record<string, unknown> = {}) {
  return new Request("http://relay.local/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-codex",
      stream: true,
      prompt_cache_key: "sess-1",
      input: [
        { role: "developer", content: "Be terse." },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
      ...body,
    }),
  });
}

const completed = (type = "response.completed") =>
  sse([
    { type: "response.created", response: {} },
    {
      type,
      response: {
        status: "completed",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 40 },
        },
      },
    },
  ]);

beforeEach(async () => {
  await resetPool();
});
afterEach(() => vi.unstubAllGlobals());

describe("normalizeCodexBody", () => {
  it("allowlists fields, forces store/stream and hoists the system prompt", () => {
    const out = normalizeCodexBody({
      model: "m",
      stream: false,
      store: true,
      max_output_tokens: 99,
      prompt_cache_retention: "24h",
      prompt_cache_options: {},
      previous_response_id: "x",
      temperature: 0.2,
      tools: [{ type: "function", name: "t" }],
      reasoning: { effort: "low" },
      input: [
        { role: "developer", content: [{ type: "input_text", text: "sys" }] },
        { role: "user", content: "hi" },
      ],
    });
    expect(out).toEqual({
      model: "m",
      instructions: "sys",
      input: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      tools: [{ type: "function", name: "t" }],
      reasoning: { effort: "low" },
      store: false,
      stream: true,
    });
  });

  it("keeps explicit instructions, defaults them otherwise, wraps string input", () => {
    const kept = normalizeCodexBody({
      instructions: "mine",
      input: [{ role: "developer", content: "stay" }],
    });
    expect(kept.instructions).toBe("mine");
    expect(kept.input).toEqual([{ role: "developer", content: "stay" }]);

    const dflt = normalizeCodexBody({ input: "hello" });
    expect(dflt.instructions).toBe("You are a helpful assistant.");
    expect(dflt.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
  });
});

describe("handleResponses", () => {
  it("sends Codex headers + body to the Codex backend, streams back and records usage", async () => {
    const a = mkCodex("a");
    const fetchMock = vi.fn(async () => completed());
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleResponses(request(), null);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("response.completed");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe(`Bearer ${CODEX_JWT}`);
    expect(h.get("chatgpt-account-id")).toBe("acct_abc");
    expect(h.get("originator")).toBe("pi");
    expect(h.get("openai-beta")).toBe("responses=experimental");
    expect(h.get("accept")).toBe("text/event-stream");
    expect(h.get("session-id")).toBe("sess-1");
    expect(h.get("x-client-request-id")).toBe("sess-1");

    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      model: "gpt-5-codex",
      store: false,
      stream: true,
      instructions: "Be terse.",
      prompt_cache_key: "sess-1",
    });
    expect(sent.input).toHaveLength(1);

    const [usage] = await waitForUsage();
    expect(usage).toMatchObject({
      accountId: a.id,
      model: "gpt-5-codex",
      inputTokens: 60,
      cacheReadTokens: 40,
      outputTokens: 20,
      status: 200,
    });
  });

  it("treats a 2xx without content-type as SSE: records usage and sets the header", async () => {
    mkCodex("a");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const upstream = completed();
        const headerless = new Response(upstream.body, { status: 200 });
        headerless.headers.delete("content-type");
        return headerless;
      }),
    );
    const res = await handleResponses(request(), null);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    await res.text();
    expect((await waitForUsage())[0]).toMatchObject({ inputTokens: 60, outputTokens: 20 });
  });

  it("falls back to the account id in the token when the row has none", async () => {
    createAccount({
      provider: "openai-codex",
      label: "no-id",
      accessToken: CODEX_JWT,
      refreshToken: "r",
      accessExpiresAt: Date.now() + 3_600_000,
    });
    const fetchMock = vi.fn(async () => completed());
    vi.stubGlobal("fetch", fetchMock);
    await (await handleResponses(request(), null)).text();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("chatgpt-account-id")).toBe("acct_abc");
  });

  it("records usage from a response.done event too", async () => {
    mkCodex("a");
    vi.stubGlobal("fetch", vi.fn(async () => completed("response.done")));
    await (await handleResponses(request(), null)).text();
    expect((await waitForUsage())[0]?.outputTokens).toBe(20);
  });

  it("429 cools the account until resets_at and fails over", async () => {
    const a = mkCodex("a", "tok-a");
    const b = mkCodex("b", "tok-b");
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const fetchMock = vi.fn(async (_u: unknown, init?: RequestInit) =>
      new Headers(init?.headers).get("authorization") === "Bearer tok-a"
        ? Response.json(
            { error: { code: "usage_limit_reached", resets_at: resetsAt } },
            { status: 429 },
          )
        : completed(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleResponses(request(), null);
    expect(res.status).toBe(200);
    await res.text();

    const cooled = getAccount(a.id)!;
    expect(cooled.state).toBe("cooling");
    expect(cooled.cooldownUntil).toBeGreaterThan(Date.now() + 3_500_000);
    expect(cooled.cooldownUntil).toBeLessThanOrEqual(resetsAt * 1000 + 1000);
    expect((await waitForUsage())[0]?.accountId).toBe(b.id);
  });

  it("401 marks the account errored and fails over; 5xx everywhere passes through", async () => {
    const a = mkCodex("a", "tok-a");
    mkCodex("b", "tok-b");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) =>
        new Headers(init?.headers).get("authorization") === "Bearer tok-a"
          ? new Response("{}", { status: 401 })
          : completed(),
      ),
    );
    const ok = await handleResponses(request(), null);
    expect(ok.status).toBe(200);
    await ok.text();
    expect(getAccount(a.id)?.state).toBe("error");

    await resetPool();
    mkCodex("c");
    mkCodex("d");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
    const res = await handleResponses(request(), null);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("boom");
  });

  it("never uses an anthropic account, and 503s when only those exist", async () => {
    createAccount({
      label: "ant",
      accessToken: "x",
      refreshToken: "r",
      accessExpiresAt: Date.now() + 3_600_000,
    });
    const fetchMock = vi.fn(async () => completed());
    vi.stubGlobal("fetch", fetchMock);
    expect((await handleResponses(request(), null)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects bad JSON, non-object bodies and stream:false", async () => {
    mkCodex("a");
    const bad = new Request("http://relay.local/v1/responses", { method: "POST", body: "{" });
    expect((await handleResponses(bad, null)).status).toBe(400);
    const arr = new Request("http://relay.local/v1/responses", { method: "POST", body: "[]" });
    expect((await handleResponses(arr, null)).status).toBe(400);
    expect((await handleResponses(request({ stream: false }), null)).status).toBe(400);
  });
});
