import { adminGuard } from "@/lib/admin-auth";
import {
  deleteAccount,
  getAccount,
  publicAccount,
  setLabel,
  setState,
  type AccountState,
} from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES: AccountState[] = ["active", "cooling", "disabled", "error"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  const { id } = await params;
  if (!getAccount(id)) {
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  }

  let body: { label?: unknown; state?: unknown };
  try {
    body = (await req.json()) as { label?: unknown; state?: unknown };
  } catch {
    return Response.json({ error: { message: "invalid body" } }, { status: 400 });
  }

  if (typeof body.label === "string" && body.label.trim()) {
    setLabel(id, body.label.trim());
  }
  if (typeof body.state === "string" && STATES.includes(body.state as AccountState)) {
    setState(id, body.state as AccountState);
  }
  return Response.json({ account: publicAccount(getAccount(id)!) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  const { id } = await params;
  deleteAccount(id);
  return Response.json({ ok: true });
}
