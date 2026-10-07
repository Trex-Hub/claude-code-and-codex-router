import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAccount } from "@/lib/accounts";
import { POST } from "@/app/v1/responses/route";
import { createKey } from "@/lib/relay-keys";
import { CODEX_JWT } from "./helpers/codex-jwt";
import { resetPool, sse } from "./helpers/relay-env";

const call = (headers: Record<string, string>) =>
  POST(
    new Request("http://relay.local/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "m", input: "hi" }),
    }),
  );

beforeEach(async () => {
  await resetPool();
});
afterEach(() => vi.unstubAllGlobals());

it("rejects unknown relay keys with an OpenAI-style 401", async () => {
  const res = await call({ authorization: "Bearer nope" });
  expect(res.status).toBe(401);
  expect((await res.json()).error.code).toBe("invalid_api_key");
});

it("accepts a relay key as Authorization: Bearer (OpenAI SDK) and relays", async () => {
  createAccount({
    provider: "openai-codex",
    label: "a",
    accessToken: CODEX_JWT,
    refreshToken: "r",
    accessExpiresAt: Date.now() + 3_600_000,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => sse([{ type: "response.completed", response: {} }])),
  );
  const key = createKey("test");
  const res = await call({ authorization: `Bearer ${key.key}` });
  expect(res.status).toBe(200);
  await res.text();
});
