import { handleResponses } from "@/lib/relay-codex";
import { extractKey, findActiveKey, touchKey } from "@/lib/relay-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const key = extractKey(req);
  const relayKey = key ? findActiveKey(key) : undefined;
  if (!relayKey) {
    // OpenAI-style error envelope, since the clients here are OpenAI SDKs.
    return Response.json(
      {
        error: {
          type: "invalid_request_error",
          code: "invalid_api_key",
          message: "invalid relay key",
        },
      },
      { status: 401 },
    );
  }
  touchKey(relayKey.id);
  return handleResponses(req, relayKey.id);
}
