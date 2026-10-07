import { adminGuard } from "@/lib/admin-auth";
import { publicAccount } from "@/lib/accounts";
import { listAccounts, type Provider } from "@/lib/accounts";
import { buildAuthorizeUrl as buildAnthropicUrl } from "@/lib/oauth/anthropic";
import { buildAuthorizeUrl as buildCodexUrl } from "@/lib/oauth/openai-codex";
import { randomBytes } from "node:crypto";
import { generatePKCE } from "@/lib/oauth/pkce";
import { startPending } from "@/lib/oauth/pending";
import { ensureCallbackServer } from "@/lib/oauth/callback-server";

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

  let body: { label?: unknown; provider?: unknown };
  try {
    body = (await req.json()) as { label?: unknown; provider?: unknown };
  } catch {
    return Response.json({ error: { message: "invalid body" } }, { status: 400 });
  }
  const provider: Provider =
    body.provider === "openai-codex" ? "openai-codex" : "anthropic";
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : provider === "openai-codex"
        ? "Codex account"
        : "Claude account";

  const { verifier, challenge } = await generatePKCE();
  // Claude Code uses the PKCE verifier as `state`; ChatGPT uses its own value.
  const state =
    provider === "openai-codex" ? randomBytes(16).toString("hex") : verifier;
  const loginId = startPending(label, verifier, provider, state);
  ensureCallbackServer(provider);
  return Response.json({
    loginId,
    authorizeUrl:
      provider === "openai-codex"
        ? buildCodexUrl(challenge, state)
        : buildAnthropicUrl(challenge, state),
  });
}
