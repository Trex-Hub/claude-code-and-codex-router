import { expect, it, vi } from "vitest";

const refreshSpy = vi.fn();

vi.mock("@/lib/oauth/anthropic", () => ({
  refreshTokens: (...args: unknown[]) => refreshSpy(...args),
  exchangeCode: vi.fn(),
  fetchProfile: vi.fn(),
  parseManualInput: vi.fn(),
  buildAuthorizeUrl: vi.fn(),
  CLIENT_ID: "test",
  AUTHORIZE_URL: "test",
  TOKEN_URL: "test",
  REDIRECT_URI: "test",
  SCOPES: "test",
}));

const codexRefreshSpy = vi.fn();
vi.mock("@/lib/oauth/openai-codex", () => ({
  refreshTokens: (...args: unknown[]) => codexRefreshSpy(...args),
}));

const { createAccount, getAccount } = await import("@/lib/accounts");
const { ensureFreshToken } = await import("@/lib/refresh");

it("single-flights concurrent refreshes of the same account", async () => {
  const account = createAccount({
    label: "expired",
    accessToken: "sk-ant-oat-old",
    refreshToken: "r1",
    accessExpiresAt: Date.now() - 1000, // already expired
  });

  refreshSpy.mockResolvedValue({
    accessToken: "sk-ant-oat-new",
    refreshToken: "r2",
    accessExpiresAt: Date.now() + 3_600_000,
  });

  const results = await Promise.all(
    Array.from({ length: 5 }, () => ensureFreshToken(account)),
  );

  expect(refreshSpy).toHaveBeenCalledTimes(1);
  for (const r of results) {
    expect(r.accessToken).toBe("sk-ant-oat-new");
  }
});

it("does not refresh when the token is still valid", async () => {
  refreshSpy.mockClear();
  const account = createAccount({
    label: "fresh",
    accessToken: "sk-ant-oat-valid",
    refreshToken: "r1",
    accessExpiresAt: Date.now() + 3_600_000,
  });

  const result = await ensureFreshToken(account);
  expect(refreshSpy).not.toHaveBeenCalled();
  expect(result.accessToken).toBe("sk-ant-oat-valid");
});

it("single-flights concurrent refreshes of a codex account and keeps its account id", async () => {
  const account = createAccount({
    provider: "openai-codex",
    label: "codex-expired",
    chatgptAccountId: "acct_old",
    accessToken: "old",
    refreshToken: "r1",
    accessExpiresAt: Date.now() - 1000,
  });
  refreshSpy.mockClear();
  codexRefreshSpy.mockResolvedValue({
    accessToken: "new",
    refreshToken: "r2",
    accessExpiresAt: Date.now() + 3_600_000,
    chatgptAccountId: "acct_new",
  });

  const results = await Promise.all(
    Array.from({ length: 5 }, () => ensureFreshToken(account)),
  );

  expect(codexRefreshSpy).toHaveBeenCalledTimes(1);
  expect(refreshSpy).not.toHaveBeenCalled();
  for (const r of results) expect(r.accessToken).toBe("new");
  expect(getAccount(account.id)?.chatgptAccountId).toBe("acct_new");
  expect(getAccount(account.id)?.refreshToken).toBe("r2");
});
