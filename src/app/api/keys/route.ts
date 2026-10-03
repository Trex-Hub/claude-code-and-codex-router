import { adminGuard } from "@/lib/admin-auth";
import { createKey, listKeys } from "@/lib/relay-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  return Response.json({ keys: listKeys() });
}

export async function POST(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  let body: { label?: unknown };
  try {
    body = (await req.json()) as { label?: unknown };
  } catch {
    body = {};
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
  return Response.json({ key: createKey(label) }, { status: 201 });
}
