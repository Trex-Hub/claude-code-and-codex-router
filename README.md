# claude-relay

A self-hosted relay that pools several Claude Code and ChatGPT/Codex
subscription seats behind Anthropic-compatible (`/v1/messages`) and
OpenAI Responses-compatible (`/v1/responses`) endpoints, with automatic
failover on rate limits.

Clients (Pi) point at the relay with a relay API key; the relay picks an
account of the right provider, refreshes its OAuth token, shapes the request
(Claude Code shaping for Anthropic, Codex body normalization for ChatGPT),
forwards upstream, and fails over to another account when one is rate
limited.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design and
[UPSTREAM.md](./UPSTREAM.md) for where the inherited shaping logic comes from.

> Deployment is on-prem, VPN/physical access only; security posture is loose by
> design (no TLS, tokens unencrypted at rest). See ARCHITECTURE.md.

## Requirements

- Node.js 24+
- pnpm
- [dbmate](https://github.com/amacneil/dbmate) (or Docker)

## Local development

```bash
cp .env.example .env      # then edit: set RELAY_ADMIN_PASSWORD and RELAY_SESSION_SECRET
pnpm install
DATABASE_URL=sqlite:./data/relay.db pnpm db:up   # run migrations
pnpm dev
```

(`pnpm start` runs migrations automatically; `pnpm dev` does not, so run
`pnpm db:up` once first.)

Open <http://localhost:3000>, sign in with `RELAY_ADMIN_PASSWORD`, then:

1. **Relay keys** → create a key. Copy it.
2. **Add account** → pick a provider (Claude or ChatGPT Codex), start login,
   open the sign-in URL and sign in. Repeat per seat.

   Anthropic redirects the browser to `http://localhost:53692/callback` (the
   only redirect the Claude Code client is registered for). While a login is
   pending the relay listens on that port, so if your browser can reach it the
   account is added automatically. This works when the browser runs on the
   relay host, with `ssh -L 53692:localhost:53692 <relay-host>`, or with
   Docker's `-p 53692:53692`. If the browser shows "connection refused", copy
   the URL from the address bar and paste it into the dashboard (it submits on
   paste).

   ChatGPT Codex logins work the same way, with redirect
   `http://localhost:1455/auth/callback` and listener port `1455`
   (`ssh -L 1455:localhost:1455 <relay-host>`, or Docker's `-p 1455:1455`).
   The OAuth client is the Codex CLI's, so no other redirect is accepted.

### Production (local)

```bash
pnpm build      # also copies .next/static into the standalone output
pnpm start      # loads .env, runs migrations, then serves the standalone server
```

`pnpm start` (via `scripts/start.mjs`) loads the root `.env`, applies pending
migrations with dbmate, then starts the standalone server — so it can never
boot against an un-migrated database. It pins `DATABASE_URL` to an absolute
path because the standalone server `chdir`s into `.next/standalone`.

`pnpm build` copies `.next/static` into `.next/standalone` so the standalone
server serves CSS; without that copy the app renders unstyled.
(`pnpm start:next` runs `next start`, which also loads `.env` but does not run
migrations.)

## Docker

```bash
docker build -t claude-relay .

docker run -d --name claude-relay \
  -p 3000:3000 \
  -p 53692:53692 \
  -p 1455:1455 \
  -v claude-relay-data:/data \
  -e RELAY_ADMIN_PASSWORD=change-me \
  -e RELAY_SESSION_SECRET=change-me-too \
  claude-relay
```

Migrations run automatically on start. The SQLite database lives on the
`/data` volume.

## Point Pi at the relay

Add a provider to `~/.pi/agent/models.json`. Pi has **no model
auto-discovery** for `models.json` providers, so list the models explicitly
(Claude's lineup is small and stable):

```json
{
  "providers": {
    "claude-relay": {
      "baseUrl": "http://relay.local:3000",
      "apiKey": "$CLAUDE_RELAY_KEY",
      "api": "anthropic-messages",
      "models": [
        { "id": "claude-sonnet-5-5", "name": "Sonnet 5.5 (relay)" },
        { "id": "claude-opus-5-5", "name": "Opus 5.5 (relay)" }
      ]
    }
  }
}
```

`apiKey` supports `$VAR` interpolation, so the secret need not be committed.

The **relay key** is this `apiKey` — create it in the dashboard under **Relay
keys**. It is *not* an environment variable; the env holds only
`RELAY_ADMIN_PASSWORD` and `RELAY_SESSION_SECRET`. Pi's Anthropic client sends
the key as the `x-api-key` header; the relay also accepts
`Authorization: Bearer <key>` for other clients.

### ChatGPT Codex provider

Add a second provider. Pi's native `openai-codex-responses` client decodes the
`apiKey` as a ChatGPT JWT, so it cannot carry a relay key; use the plain
`openai-responses` API instead. The OpenAI SDK appends `/responses` to
`baseUrl`, so `/v1` must be part of it:

```json
{
  "providers": {
    "codex-relay": {
      "baseUrl": "http://relay.local:3000/v1",
      "apiKey": "$CLAUDE_RELAY_KEY",
      "api": "openai-responses",
      "models": [
        { "id": "gpt-5.5", "name": "GPT-5.5 (relay)", "reasoning": true }
      ]
    }
  }
}
```

The same relay key works for both providers (`Authorization: Bearer` here).
Model ids and limits come from pi-ai's `openai-codex` catalog
(`models.generated.js`); list the ones your plan serves.

Notes:

- Only streaming is supported; `stream: false` returns `400`.
- Codex wants `instructions` and `store: false`; the relay moves the first
  `developer`/`system` input message into `instructions` and forces both.
- A `429` cools the seat down until the reset time Codex reports (can be
  hours for the 5h/weekly windows), then fails over to another seat.
- Token counts are stored as `input − cached` and `cache_read = cached`,
  matching the Anthropic rows.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | dev server |
| `pnpm build` / `pnpm start` | production build / standalone serve |
| `pnpm test` | unit tests (shaping, selection, single-flight refresh) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:up` / `db:down` | run / roll back migrations |
| `pnpm db:new <name>` | create a new migration |

## Layout

```
src/lib/shaping/   vendored from pi-anthropic-auth (MIT) — the request shaping
src/lib/oauth/     Claude Code + ChatGPT Codex OAuth (login, refresh, profile)
src/lib/accounts   account store + state machine
src/lib/refresh    single-flight token refresh
src/lib/relay-core shared forward + failover loop (provider adapters plug in)
src/lib/relay      Anthropic adapter (/v1/messages)
src/lib/relay-codex Codex adapter (/v1/responses): body normalization, usage
src/app/v1         relay endpoints — /v1/messages (+count_tokens), /v1/responses
src/app/api        dashboard API
src/app            dashboard UI
db/migrations      dbmate SQL migrations
```
