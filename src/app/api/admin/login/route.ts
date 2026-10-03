import { ADMIN_COOKIE, checkPassword, createSession } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return Response.json({ error: { message: "invalid body" } }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    return Response.json(
      { error: { message: "invalid password" } },
      { status: 401 },
    );
  }
  const res = Response.json({ ok: true });
  res.headers.append(
    "set-cookie",
    `${ADMIN_COOKIE}=${createSession()}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
  );
  return res;
}
