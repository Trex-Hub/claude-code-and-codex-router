import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/lib/accounts";
import { handleResponses } from "@/lib/relay-codex";
import { usageByAccount } from "@/lib/usage";
import { CODEX_JWT } from "./helpers/codex-jwt";
import { resetPool, sse, waitForUsage } from "./helpers/relay-env";

/**
 * Usage accounting is the thing the dashboard reports, and it is easy to get
 * subtly wrong: OpenAI counts cached input *inside* `input_tokens`, Anthropic
 * reports it separately. These tests pin the invariant the UI relies on —
 * `inputTokens`, `cacheReadTokens` and `cacheWriteTokens` are stored as three
 * disjoint buckets, so their sum is the true input volume and `cacheReadTokens`
 * is the cached subset of it.
 */

function mkCodex() {
  return createAccount({
    provider: "openai-codex",
    label: "codex",
    chatgptAccountId: "acct_abc",
    accessToken: CODEX_JWT,
    refreshToken: "r",
    accessExpiresAt: Date.now() + 3_600_000,
  });
}

function request() {
  return new Request("http://relay.local/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-5-codex", stream: true, input: "hi" }),
  });
}

/** A completed response carrying OpenAI's nested usage shape. */
function completed(inputTokens: number, cachedTokens: number, outputTokens: number) {
  return sse([
    {
      type: "response.completed",
      response: {
        status: "completed",
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          input_tokens_details: { cached_tokens: cachedTokens },
        },
      },
    },
  ]);
}

beforeEach(async () => {
  await resetPool();
});
afterEach(() => vi.unstubAllGlobals());

describe("Codex usage accounting", () => {
  it("stores cached tokens outside input_tokens, once", async () => {
    const a = mkCodex();
    vi.stubGlobal("fetch", vi.fn(async () => completed(20_000, 19_000, 500)));

    await (await handleResponses(request(), null)).text();
    const [usage] = await waitForUsage();

    // Fresh input is what remains after the cached tokens are removed, so the
    // three buckets stay disjoint and cannot be double counted.
    expect(usage).toMatchObject({
      inputTokens: 1_000,
      cacheReadTokens: 19_000,
      cacheWriteTokens: null,
      outputTokens: 500,
    });
    expect(usage.inputTokens! + usage.cacheReadTokens!).toBe(20_000);
  });

  it("does not double count when OpenAI reports nothing cached", async () => {
    mkCodex();
    vi.stubGlobal("fetch", vi.fn(async () => completed(1_000, 0, 250)));
    await (await handleResponses(request(), null)).text();
    expect((await waitForUsage())[0]).toMatchObject({
      inputTokens: 1_000,
      cacheReadTokens: 0,
      outputTokens: 250,
    });
  });

  it("falls back to input_tokens when the details object is missing", async () => {
    mkCodex();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          {
            type: "response.completed",
            response: { status: "completed", usage: { input_tokens: 700, output_tokens: 30 } },
          },
        ]),
      ),
    );
    await (await handleResponses(request(), null)).text();
    expect((await waitForUsage())[0]).toMatchObject({
      inputTokens: 700,
      cacheReadTokens: null,
      outputTokens: 30,
    });
  });

  it("totals input across both providers consistently in usageByAccount", async () => {
    const codex = mkCodex();
    createAccount({
      provider: "anthropic",
      label: "claude",
      accessToken: "t",
      refreshToken: "r",
      accessExpiresAt: Date.now() + 3_600_000,
    });

    // Codex: 20k input of which 19k cached. Anthropic: 5k fresh + 40k cache
    // read + 10k cache write, reported separately.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("authorization");
        return auth === `Bearer ${CODEX_JWT}`
          ? completed(20_000, 19_000, 500)
          : sse([
              {
                type: "message_start",
                message: {
                  usage: {
                    input_tokens: 5_000,
                    output_tokens: 1,
                    cache_read_input_tokens: 40_000,
                    cache_creation_input_tokens: 10_000,
                  },
                },
              },
            ]);
      }),
    );

    await (await handleResponses(request(), null)).text();
    await waitForUsage(1);

    const { handleMessages } = await import("@/lib/relay");
    const anthropicReq = new Request("http://relay.local/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", messages: [] }),
    });
    await (await handleMessages(anthropicReq, null)).text();
    await waitForUsage(2);

    const rows = usageByAccount();
    const codexRow = rows.find((r) => r.accountId === codex.id)!;
    const byLabel = Object.fromEntries(rows.map((r) => [r.accountId, r]));

    // Every row must satisfy: total input = fresh + cache read + cache write,
    // and the cached column must never exceed the total.
    for (const r of Object.values(byLabel)) {
      const total = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
      expect(total).toBeGreaterThanOrEqual(r.cacheReadTokens);
      expect(r.inputTokens).toBeGreaterThanOrEqual(0);
    }

    const totals = Object.values(byLabel).reduce(
      (acc, r) => ({
        input: acc.input + r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens,
        cached: acc.cached + r.cacheReadTokens,
        output: acc.output + r.outputTokens,
      }),
      { input: 0, cached: 0, output: 0 },
    );

    expect(codexRow.inputTokens).toBe(1_000);
    // 20k (codex) + 55k (anthropic) = 75k total input, of which 59k was cached.
    expect(totals.input).toBe(75_000);
    expect(totals.cached).toBe(59_000);
  });
});
