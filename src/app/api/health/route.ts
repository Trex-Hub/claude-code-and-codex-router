import { listAccounts } from "@/lib/accounts";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    getDb().prepare("SELECT 1").get();
    const accounts = listAccounts();
    return Response.json({
      ok: true,
      activeAccounts: accounts.filter((a) => a.state === "active").length,
      totalAccounts: accounts.length,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message },
      { status: 503 },
    );
  }
}
