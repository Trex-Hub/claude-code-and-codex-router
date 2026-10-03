import { adminGuard } from "@/lib/admin-auth";
import { recentUsage, usageByAccount } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const denied = adminGuard(req);
  if (denied) return denied;
  return Response.json({
    byAccount: usageByAccount(),
    recent: recentUsage(25),
  });
}
