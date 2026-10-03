import { env } from "../env";
import type { AccountProfile } from "../accounts";

/**
 * Claude Code / Claude Pro-Max OAuth endpoints and flow.
 *
 * Constants verified against pi-ai@0.84.2 `auth/oauth/anthropic.js` and the
 * Claude Code CLI 2.1.286. See UPSTREAM.md.
 */
export const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
/**
 * The redirect target the CLI client is registered for. In the headless relay
 * flow the browser lands here and the admin copies the resulting URL (or code)
 * back into the dashboard — no callback server is run on the relay.
 */
export const REDIRECT_URI = "http://localhost:53692/callback";
export const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const OAUTH_BETA = "oauth-2025-04-20";
const PROFILE_TIMEOUT_MS = 5000;

/** Builds the authorize URL the admin opens in a browser. */
export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

function computeExpiry(expiresInSeconds: number): number {
  return Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000;
}

async function postJson(
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`token request failed: status=${response.status} body=${text}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Exchanges an authorization code for tokens. */
export async function exchangeCode(input: {
  code: string;
  state: string;
  verifier: string;
}): Promise<Tokens> {
  const data = await postJson({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code: input.code,
    state: input.state,
    redirect_uri: REDIRECT_URI,
    code_verifier: input.verifier,
  });
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    accessExpiresAt: computeExpiry(Number(data.expires_in)),
  };
}

/** Refreshes an access token. */
export async function refreshTokens(refreshToken: string): Promise<Tokens> {
  const data = await postJson({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    accessExpiresAt: computeExpiry(Number(data.expires_in)),
  };
}

/**
 * Parses the admin's pasted input from the browser: either the full redirect
 * URL (`.../callback?code=...&state=...`), a `code#state` string, or a bare
 * code. Ported from pi-ai's `parseAuthorizationInput`.
 */
export function parseManualInput(input: string): {
  code?: string;
  state?: string;
} {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // not a URL
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }
  return { code: value };
}

/** Fetches the subscription/plan profile behind an OAuth access token. */
export async function fetchProfile(
  accessToken: string,
): Promise<AccountProfile | null> {
  try {
    const response = await fetch(`${env.anthropicApiBase()}/api/oauth/profile`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": OAUTH_BETA,
      },
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const account = (body.account ?? {}) as Record<string, unknown>;
    const organization = (body.organization ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
    return {
      organizationType: str(organization.organization_type),
      rateLimitTier: str(organization.rate_limit_tier),
      seatTier: str(organization.seat_tier),
      subscriptionStatus: str(organization.subscription_status),
      hasExtraUsageEnabled: bool(organization.has_extra_usage_enabled),
      email: str(account.email),
      organizationName: str(organization.name),
    };
  } catch {
    return null;
  }
}
