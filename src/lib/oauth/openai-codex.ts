import type { Tokens } from "./anthropic";

/**
 * ChatGPT (Codex subscription) OAuth endpoints and flow.
 *
 * Constants ported from pi-ai@1.0.4 `auth/oauth/openai-codex.js` (browser
 * login only; the device-code flow is not needed). See UPSTREAM.md.
 */
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
export const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
export const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
/**
 * The redirect the client is registered for. Port 1455 is shared with the
 * Codex CLI; when it is busy the admin pastes the redirect URL instead.
 */
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const SCOPE = "openid profile email offline_access";
/** Identifies the traffic as Pi, matching what pi-ai sends. */
export const ORIGINATOR = "pi";

const JWT_AUTH_CLAIM = "https://api.openai.com/auth";
const JWT_PROFILE_CLAIM = "https://api.openai.com/profile";

export interface CodexTokens extends Tokens {
  chatgptAccountId: string;
  planType: string | null;
  email: string | null;
}

/** Builds the authorize URL the admin opens in a browser. */
export function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", ORIGINATOR);
  return url.toString();
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Reads the ChatGPT account id (and display fields) out of an access token. */
export function readClaims(accessToken: string): {
  chatgptAccountId: string | null;
  planType: string | null;
  email: string | null;
} {
  const payload = decodeJwt(accessToken);
  const auth = (payload?.[JWT_AUTH_CLAIM] ?? {}) as Record<string, unknown>;
  const profile = (payload?.[JWT_PROFILE_CLAIM] ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    chatgptAccountId: str(auth.chatgpt_account_id),
    planType: str(auth.chatgpt_plan_type),
    email: str(profile.email),
  };
}

async function postForm(
  body: Record<string, string>,
  operation: string,
): Promise<CodexTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `token ${operation} failed: status=${response.status} body=${text || response.statusText}`,
    );
  }
  const json = (await response.json()) as Record<string, unknown>;
  if (
    typeof json.access_token !== "string" ||
    typeof json.refresh_token !== "string" ||
    typeof json.expires_in !== "number"
  ) {
    throw new Error(`token ${operation} response missing fields`);
  }
  const claims = readClaims(json.access_token);
  if (!claims.chatgptAccountId) {
    throw new Error("failed to extract chatgpt_account_id from access token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessExpiresAt: Date.now() + json.expires_in * 1000,
    chatgptAccountId: claims.chatgptAccountId,
    planType: claims.planType,
    email: claims.email,
  };
}

/** Exchanges an authorization code for tokens. */
export function exchangeCode(input: {
  code: string;
  verifier: string;
}): Promise<CodexTokens> {
  return postForm(
    {
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: REDIRECT_URI,
    },
    "exchange",
  );
}

/** Refreshes an access token. The refresh token rotates on every call. */
export function refreshTokens(refreshToken: string): Promise<CodexTokens> {
  return postForm(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    },
    "refresh",
  );
}
