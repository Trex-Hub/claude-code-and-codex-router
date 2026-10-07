import { handleMessages } from "@/lib/relay";
import { extractKey, findActiveKey, touchKey } from "@/lib/relay-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
