import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const ADMIN_COOKIE = "relay_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value: string): string {
  return createHmac("sha256", env.sessionSecret()).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Constant-time password check against RELAY_ADMIN_PASSWORD. */
export function checkPassword(password: string): boolean {
  return safeEqual(password, env.adminPassword());
}

/** A signed session token: `<expiry>.<hmac>`. */
export function createSession(): string {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return `${expiry}.${sign(expiry)}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const [expiry, mac] = token.split(".");
  if (!expiry || !mac) return false;
  if (!safeEqual(mac, sign(expiry))) return false;
  return Number(expiry) > Date.now();
}

/** Returns a 401 response when the request is not an authenticated admin. */
export function adminGuard(req: Request): Response | null {
  if (isAdminRequest(req)) return null;
  return Response.json(
    { error: { message: "unauthorized" } },
    { status: 401 },
  );
}

/** Reads the admin cookie off a Request. */
export function isAdminRequest(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`));
  const token = match?.slice(ADMIN_COOKIE.length + 1);
  return verifySession(token);
}
