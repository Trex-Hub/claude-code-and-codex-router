import { adminGuard } from "@/lib/admin-auth";
import { publicAccount } from "@/lib/accounts";
import { listAccounts } from "@/lib/accounts";
import { buildAuthorizeUrl } from "@/lib/oauth/anthropic";
import { generatePKCE } from "@/lib/oauth/pkce";
import { startPending } from "@/lib/oauth/pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  return Response.json({ accounts: listAccounts().map(publicAccount) });
}

/** Starts an add-account OAuth login; returns the authorize URL to open. */
export async function POST(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;

  let body: { label?: unknown };
  try {
    body = (await req.json()) as { label?: unknown };
  } catch {
    return Response.json({ error: { message: "invalid body" } }, { status: 400 });
  }
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : "Claude account";

  const { verifier, challenge } = await generatePKCE();
  // Per the Claude Code flow, `state` is the PKCE verifier.
  const loginId = startPending(label, verifier);
  return Response.json({
    loginId,
    authorizeUrl: buildAuthorizeUrl(challenge, verifier),
  });
}
