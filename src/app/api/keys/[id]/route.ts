import { adminGuard } from "@/lib/admin-auth";
import { deleteKey } from "@/lib/relay-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  const { id } = await params;
  deleteKey(id);
  return Response.json({ ok: true });
}
