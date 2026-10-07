import { afterEach, describe, expect, it, vi } from "vitest";
import { listAccounts } from "@/lib/accounts";
import {
  closeCallbackServerIfIdle,
  ensureCallbackServer,
} from "@/lib/oauth/callback-server";
import { getOutcome, startPending } from "@/lib/oauth/pending";
import { CODEX_JWT } from "./helpers/codex-jwt";

afterEach(() => vi.unstubAllGlobals());

describe("oauth callback listener", () => {
  it("completes a pending login from the browser redirect", async () => {
    const realFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith("http://localhost:53692")) {
          return realFetch(url, init);
        }
        if (String(url).includes("/v1/oauth/token")) {
          return Response.json({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
          });
        }
        return new Response("{}", { status: 404 }); // profile
      }),
    );

    const before = listAccounts().length;
    const id = startPending("via-callback", "verifier-123");
    startPending("keeps-listener-open", "other-verifier");
    ensureCallbackServer();
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(
      "http://localhost:53692/callback?code=abc&state=verifier-123",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Account added");
    expect(getOutcome(id)).toEqual({ status: "complete" });
    expect(listAccounts().length).toBe(before + 1);

    const unknown = await fetch("http://localhost:53692/callback?code=x&state=nope");
    expect(unknown.status).toBe(404);
    closeCallbackServerIfIdle();
  });

  it("completes a codex login on :1455 and keeps the providers' pending logins separate", async () => {
    const realFetch = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith("http://localhost:1455")) {
          return realFetch(url, init);
        }
        if (String(url).startsWith("https://auth.openai.com/oauth/token")) {
          return Response.json({
            access_token: CODEX_JWT,
            refresh_token: "rt",
            expires_in: 3600,
          });
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const id = startPending("via-codex-callback", "ver", "openai-codex", "codex-state");
    // Same state on the other provider must not match.
    startPending("anthropic-twin", "other", "anthropic", "codex-state");
    // Keeps the codex listener open so the replay below reaches it.
    startPending("keeps-codex-open", "v2", "openai-codex", "other-state");
    ensureCallbackServer("openai-codex");
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(
      "http://localhost:1455/auth/callback?code=abc&state=codex-state",
    );
    expect(res.status).toBe(200);
    expect(getOutcome(id)).toEqual({ status: "complete" });

    const account = listAccounts().find((a) => a.label === "via-codex-callback");
    expect(account?.provider).toBe("openai-codex");
    expect(account?.chatgptAccountId).toBe("acct_abc");
    expect(account?.planTier).toBe("plus");
    expect(account?.email).toBe("dev@example.com");

    const replay = await fetch(
      "http://localhost:1455/auth/callback?code=abc&state=codex-state",
    );
    expect(replay.status).toBe(404);
    closeCallbackServerIfIdle();
  });
});
