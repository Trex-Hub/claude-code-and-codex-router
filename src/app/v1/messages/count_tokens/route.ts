import { handleMessages } from "@/lib/relay";
import { findActiveKey, touchKey } from "@/lib/relay-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractKey(req: Request): string | null {
  const apiKey = req.headers.get("x-api-key")?.trim();
  if (apiKey) return apiKey;
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  return key || null;
}

export async function POST(req: Request): Promise<Response> {
  const key = extractKey(req);
  const relayKey = key ? findActiveKey(key) : undefined;
  if (!relayKey) {
    return Response.json(
      { error: { type: "authentication_error", message: "invalid relay key" } },
      { status: 401 },
    );
  }
  touchKey(relayKey.id);
  return handleMessages(req, relayKey.id, "/v1/messages/count_tokens");
}
