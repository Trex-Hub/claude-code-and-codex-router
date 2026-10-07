import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, getAccount } from "@/lib/accounts";
import { handleMessages } from "@/lib/relay";
import { resetPool, sse, waitForUsage } from "./helpers/relay-env";

function mkAccount(label: string, token: string) {
  return createAccount({
    label,
    accessToken: token,
    refreshToken: "r",
    accessExpiresAt: Date.now() + 3_600_000,
  });
}

function request() {
  return new Request("http://relay.local/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-beta": "client-beta" },
    body: JSON.stringify({
      model: "claude-sonnet-x",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

const okStream = () =>
  sse([
    { type: "message_start", message: { usage: { input_tokens: 11, cache_read_input_tokens: 3 } } },
    { type: "message_delta", usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ]);

beforeEach(async () => {
  await resetPool();
});
afterEach(() => vi.unstubAllGlobals());

describe("handleMessages (anthropic)", () => {
  it("forwards with the account token, streams through and records usage", async () => {
    const a = mkAccount("a", "tok-a");
    const fetchMock = vi.fn(async () => okStream());
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleMessages(request(), null);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("message_stop");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer tok-a");
    expect(h.get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(h.get("anthropic-beta")).toContain("client-beta");

    const [usage] = await waitForUsage();
    expect(usage).toMatchObject({
      accountId: a.id,
      model: "claude-sonnet-x",
      // message_start's input/cache counts survive message_delta's output-only usage.
      inputTokens: 11,
      cacheReadTokens: 3,
      outputTokens: 7,
      status: 200,
    });
  });

  it("cools down a 429 account and fails over to the next", async () => {
    const a = mkAccount("a", "tok-a");
    const b = mkAccount("b", "tok-b");
    // Whichever seat affinity picks first is rate limited; the other succeeds.
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1
        ? new Response("{}", { status: 429, headers: { "retry-after": "30" } })
        : okStream();
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleMessages(request(), null);
    expect(res.status).toBe(200);
    await res.text();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Exactly one seat was tried first and has to be cooling.
    const cooling = [a, b].filter((x) => getAccount(x.id)?.state === "cooling");
    expect(cooling).toHaveLength(1);
    const [usage] = await waitForUsage();
    expect(usage?.accountId).not.toBe(cooling[0]?.id);
  });

  it("passes the last response through when every account is limited", async () => {
    mkAccount("a", "tok-a");
    mkAccount("b", "tok-b");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"e":1}', { status: 429 })));

    const res = await handleMessages(request(), null);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('{"e":1}');
  });

  it("returns 4xx without failover", async () => {
    mkAccount("a", "tok-a");
    mkAccount("b", "tok-b");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleMessages(request(), null);
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with no eligible accounts and 400 on bad JSON", async () => {
    expect((await handleMessages(request(), null)).status).toBe(503);
    const bad = new Request("http://relay.local/v1/messages", { method: "POST", body: "{" });
    expect((await handleMessages(bad, null)).status).toBe(400);
  });
});
