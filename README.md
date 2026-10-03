# claude-relay

A self-hosted relay that pools several Claude Code subscription seats behind
one Anthropic-compatible endpoint, with automatic failover on rate limits.

Clients (Pi) point at the relay with a relay API key; the relay picks an
account, refreshes its OAuth token, applies the Claude Code request shaping,
forwards to Anthropic, and fails over to another account when one is rate
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
2. **Add account** → start login, open the Claude sign-in URL, sign in, paste
   the code (or the full redirect URL) back. Repeat per seat.

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
src/lib/oauth/     Claude Code OAuth (PKCE login, refresh, profile)
src/lib/accounts   account store + state machine
src/lib/refresh    single-flight token refresh
src/lib/relay      the /v1/messages forward + failover
src/app/v1         relay endpoint — /v1/messages (+count_tokens)
src/app/api        dashboard API
src/app            dashboard UI
db/migrations      dbmate SQL migrations
```
