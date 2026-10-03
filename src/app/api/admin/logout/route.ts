import { ADMIN_COOKIE } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = Response.json({ ok: true });
  res.headers.append(
    "set-cookie",
    `${ADMIN_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
  return res;
}
