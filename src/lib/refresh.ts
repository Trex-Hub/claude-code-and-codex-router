import { getAccount, markError, setTokens, type Account } from "./accounts";
import { refreshTokens } from "./oauth/anthropic";

/** Refresh when the access token expires within this window. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/**
 * In-flight refreshes keyed by account id.
 *
 * Single-flight is the highest-risk correctness path in the system: a refresh
 * stampede (N concurrent requests each refreshing the same account) can rotate
 * the refresh token into invalidity and log the account out. Concurrent
 * callers must share one refresh.
 */
declare global {
  // eslint-disable-next-line no-var
  var __claudeRelayInflightRefresh: Map<string, Promise<Account>> | undefined;
}

function inflight(): Map<string, Promise<Account>> {
  if (!globalThis.__claudeRelayInflightRefresh) {
    globalThis.__claudeRelayInflightRefresh = new Map();
  }
  return globalThis.__claudeRelayInflightRefresh;
}

async function doRefresh(accountId: string): Promise<Account> {
  // Re-read: another refresh may have completed while we waited for the lock.
  const current = getAccount(accountId);
  if (!current) throw new Error(`account ${accountId} disappeared`);
  if (current.accessExpiresAt > Date.now() + REFRESH_WINDOW_MS) {
    return current;
  }

  try {
    const tokens = await refreshTokens(current.refreshToken);
    setTokens(
      accountId,
      tokens.accessToken,
      tokens.refreshToken,
      tokens.accessExpiresAt,
    );
    return getAccount(accountId)!;
  } catch (error) {
    markError(accountId, `refresh failed: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Returns the account with a valid access token, refreshing if it is within
 * the refresh window. Single-flight per account.
 */
export async function ensureFreshToken(account: Account): Promise<Account> {
  if (account.accessExpiresAt > Date.now() + REFRESH_WINDOW_MS) {
    return account;
  }

  const existing = inflight().get(account.id);
  if (existing) return existing;

  const promise = doRefresh(account.id).finally(() => {
    inflight().delete(account.id);
  });
  inflight().set(account.id, promise);
  return promise;
}
