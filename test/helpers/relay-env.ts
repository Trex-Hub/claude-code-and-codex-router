import { deleteAccount, listAccounts } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import { recentUsage } from "@/lib/usage";

/**
 * Wipes accounts + usage so each test starts from a known pool. Waits a tick
 * first so usage rows still being written for the previous request land before
 * their account disappears (FK).
 */
export async function resetPool(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
  getDb().exec("DELETE FROM usage_events");
  for (const a of listAccounts()) deleteAccount(a.id);
}

/** Usage is recorded after the stream is consumed; wait for it to land. */
export async function waitForUsage(count = 1) {
  for (let i = 0; i < 50; i++) {
    const rows = recentUsage(50);
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 10));
  }
  return recentUsage(50);
}

export function sse(events: Array<Record<string, unknown>>): Response {
  const body = events
    .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
