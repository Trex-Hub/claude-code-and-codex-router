import { adminGuard } from "@/lib/admin-auth";
import {
  createAccount,
  getAccount,
  publicAccount,
  setProfile,
} from "@/lib/accounts";
import { exchangeCode, fetchProfile, parseManualInput } from "@/lib/oauth/anthropic";
import { takePending } from "@/lib/oauth/pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Completes an add-account login. The admin pastes the code or the full
 * redirect URL from the browser; we exchange it for tokens and store the
 * account.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  const { id } = await params;

  const pending = takePending(id);
  if (!pending) {
    return Response.json(
      { error: { message: "login expired or unknown" } },
      { status: 404 },
    );
  }

  let body: { input?: unknown };
  try {
    body = (await req.json()) as { input?: unknown };
  } catch {
    return Response.json({ error: { message: "invalid body" } }, { status: 400 });
  }
  const input = typeof body.input === "string" ? body.input : "";
  const parsed = parseManualInput(input);
  if (!parsed.code) {
    return Response.json(
      { error: { message: "no authorization code found in the pasted input" } },
      { status: 400 },
    );
  }
  if (parsed.state && parsed.state !== pending.verifier) {
    return Response.json(
      { error: { message: "OAuth state mismatch" } },
      { status: 400 },
    );
  }

  let tokens;
  try {
    tokens = await exchangeCode({
      code: parsed.code,
      state: parsed.state ?? pending.verifier,
      verifier: pending.verifier,
    });
  } catch (error) {
    return Response.json(
      { error: { message: `token exchange failed: ${(error as Error).message}` } },
      { status: 400 },
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

  return Response.json({ account: publicAccount(getAccount(account.id)!) });
}
