import { createServer, type Server } from "node:http";
import type { Provider } from "../accounts";
import { REDIRECT_URI as ANTHROPIC_REDIRECT_URI } from "./anthropic";
import { REDIRECT_URI as CODEX_REDIRECT_URI } from "./openai-codex";
import { LoginError, completeLogin } from "./complete";
import { pendingCount, recordOutcome, takePendingByState } from "./pending";

/**
 * Temporary listeners for the OAuth redirect, one per provider.
 *
 * Each OAuth client is registered for one localhost redirect only
 * (Claude Code: `:53692/callback`, ChatGPT Codex: `:1455/auth/callback`), so
 * the provider always redirects the *browser* to its own localhost. When the
 * browser can reach the listener (same machine as the relay, an open port, or
 * `ssh -L`), the login completes with no paste. Otherwise the
 * browser shows "connection refused" and the admin falls back to pasting the
 * URL into the dashboard.
 *
 * A listener runs only while a login for its provider is pending; the callback
 * is accepted only for a known `state`.
 */
const REDIRECTS: Record<Provider, URL> = {
  anthropic: new URL(ANTHROPIC_REDIRECT_URI),
  "openai-codex": new URL(CODEX_REDIRECT_URI),
};
const IDLE_CHECK_MS = 16 * 60 * 1000; // just past the pending-login TTL

declare global {
  // eslint-disable-next-line no-var
  var __claudeRelayCallbackServers: Map<Provider, Server> | undefined;
}

function servers(): Map<Provider, Server> {
  if (!globalThis.__claudeRelayCallbackServers) {
    globalThis.__claudeRelayCallbackServers = new Map();
  }
  return globalThis.__claudeRelayCallbackServers;
}

function page(title: string, message: string, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>${title}</h1><p>${message}</p></body>`;
  return { status, html };
}

/** Closes each provider's listener once no login is waiting on it. */
export function closeCallbackServerIfIdle(): void {
  for (const [provider, server] of servers()) {
    if (pendingCount(provider) === 0) {
      server.close();
      servers().delete(provider);
    }
  }
}

/** Starts the provider's listener if it isn't running. Failure (port busy) is non-fatal. */
export function ensureCallbackServer(provider: Provider = "anthropic"): void {
  if (servers().has(provider)) return;
  const redirect = REDIRECTS[provider];
  const PORT = Number(redirect.port);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", redirect);
    let out;
    if (url.pathname !== redirect.pathname) {
      out = page("Not found", "Nothing here.", 404);
    } else {
      const state = url.searchParams.get("state");
      const pending = state ? takePendingByState(provider, state) : undefined;
      if (!pending) {
        out = page(
          "Login expired",
          "This login is unknown or has expired. Start again from the relay dashboard.",
          404,
        );
      } else {
        try {
          await completeLogin(pending, url.toString());
          recordOutcome(pending.id, { status: "complete" });
          out = page(
            "Account added",
            "You can close this tab and return to the relay dashboard.",
          );
        } catch (error) {
          const message =
            error instanceof LoginError ? error.message : "unexpected error";
          recordOutcome(pending.id, { status: "error", message });
          out = page("Login failed", message, 400);
        }
      }
    }
    res.writeHead(out.status, { "content-type": "text/html; charset=utf-8" });
    res.end(out.html);
    closeCallbackServerIfIdle();
  });

  server.on("error", (error) => {
    console.warn(
      `[claude-relay] OAuth callback listener unavailable on :${PORT} (${(error as Error).message}); paste the redirect URL into the dashboard instead`,
    );
    if (servers().get(provider) === server) servers().delete(provider);
  });
  servers().set(provider, server);
  server.listen(PORT, process.env.RELAY_OAUTH_CALLBACK_HOST ?? "127.0.0.1");

  setTimeout(closeCallbackServerIfIdle, IDLE_CHECK_MS).unref();
}
