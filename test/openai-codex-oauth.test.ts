import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_ID,
  REDIRECT_URI,
  buildAuthorizeUrl,
  exchangeCode,
  readClaims,
  refreshTokens,
} from "@/lib/oauth/openai-codex";
import { CODEX_JWT, fakeJwt } from "./helpers/codex-jwt";

afterEach(() => vi.unstubAllGlobals());

describe("openai-codex oauth", () => {
  it("builds the authorize URL with the Codex client params", () => {
    const url = new URL(buildAuthorizeUrl("chal", "st8"));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(p.get("code_challenge")).toBe("chal");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("state")).toBe("st8");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("codex_cli_simplified_flow")).toBe("true");
    expect(p.get("originator")).toBe("pi");
  });

  it("reads account id, plan and email from the access token", () => {
    expect(readClaims(CODEX_JWT)).toEqual({
      chatgptAccountId: "acct_abc",
      planType: "plus",
      email: "dev@example.com",
    });
    expect(readClaims("not-a-jwt").chatgptAccountId).toBeNull();
    expect(readClaims(fakeJwt({})).chatgptAccountId).toBeNull();
  });

  it("exchanges a code with a form-encoded body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ access_token: CODEX_JWT, refresh_token: "rt", expires_in: 3600 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCode({ code: "c0de", verifier: "ver" });
    expect(tokens.chatgptAccountId).toBe("acct_abc");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.accessExpiresAt).toBeGreaterThan(Date.now() + 3_500_000);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.openai.com/oauth/token");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("c0de");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("refreshes and rejects tokens without an account id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ access_token: CODEX_JWT, refresh_token: "rt2", expires_in: 60 }),
      ),
    );
    expect((await refreshTokens("rt")).refreshToken).toBe("rt2");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ access_token: fakeJwt({}), refresh_token: "r", expires_in: 60 }),
      ),
    );
    await expect(refreshTokens("rt")).rejects.toThrow(/chatgpt_account_id/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    await expect(refreshTokens("rt")).rejects.toThrow(/status=400/);
  });
});
