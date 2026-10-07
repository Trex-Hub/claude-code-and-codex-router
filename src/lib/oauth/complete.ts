import {
  createAccount,
  getAccount,
  publicAccount,
  setProfile,
} from "../accounts";
import {
  exchangeCode as exchangeAnthropic,
  fetchProfile,
  parseManualInput,
} from "./anthropic";
import { exchangeCode as exchangeCodex } from "./openai-codex";
import type { PendingLogin } from "./pending";

/** A login failure with the HTTP status the API route should surface. */
export class LoginError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Finishes an add-account login from the pasted input / callback URL:
 * exchanges the code for tokens, stores the account and fetches its profile.
 * The caller must already have claimed `pending` via `takePending`.
 */
export async function completeLogin(pending: PendingLogin, input: string) {
  const parsed = parseManualInput(input);
  if (!parsed.code) {
    throw new LoginError("no authorization code found in the pasted input", 400);
  }
  if (parsed.state && parsed.state !== pending.state) {
    throw new LoginError("OAuth state mismatch", 400);
  }

  if (pending.provider === "openai-codex") {
    return completeCodex(pending, parsed.code);
  }

  let tokens;
  try {
    tokens = await exchangeAnthropic({
      code: parsed.code,
      state: parsed.state ?? pending.state,
      verifier: pending.verifier,
    });
  } catch (error) {
    throw new LoginError(
      `token exchange failed: ${(error as Error).message}`,
      400,
    );
  }

  const account = createAccount({
    label: pending.label,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt,
  });

  const profile = await fetchProfile(tokens.accessToken);
  if (profile) setProfile(account.id, profile);

  return publicAccount(getAccount(account.id)!);
}

/** ChatGPT Codex: identity and plan come from the access-token JWT claims. */
async function completeCodex(pending: PendingLogin, code: string) {
  let tokens;
  try {
    tokens = await exchangeCodex({ code, verifier: pending.verifier });
  } catch (error) {
    throw new LoginError(
      `token exchange failed: ${(error as Error).message}`,
      400,
    );
  }

  const account = createAccount({
    provider: "openai-codex",
    label: pending.label,
    chatgptAccountId: tokens.chatgptAccountId,
    planTier: tokens.planType,
    email: tokens.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.accessExpiresAt,
  });
  return publicAccount(getAccount(account.id)!);
}
