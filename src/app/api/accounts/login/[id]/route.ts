import { adminGuard } from "@/lib/admin-auth";
import { getOutcome, hasPending, takePending } from "@/lib/oauth/pending";
import { LoginError, completeLogin } from "@/lib/oauth/complete";
import { closeCallbackServerIfIdle } from "@/lib/oauth/callback-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Login progress, polled by the dashboard so it can pick up a login that the
 * local callback listener completed without any paste.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  const { id } = await params;

  const outcome = getOutcome(id);
  if (outcome) return Response.json(outcome);
  return Response.json({ status: hasPending(id) ? "pending" : "unknown" });
}

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

  try {
    const account = await completeLogin(pending, input);
    return Response.json({ account });
  } catch (error) {
    if (error instanceof LoginError) {
      return Response.json(
        { error: { message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  } finally {
    closeCallbackServerIfIdle();
  }
}
