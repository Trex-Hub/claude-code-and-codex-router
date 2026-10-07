# claude-router — Architecture (v1)

A self-hosted relay that pools several Claude Code and ChatGPT/Codex subscription
seats behind an Anthropic-compatible endpoint (`/v1/messages`) and an OpenAI
Responses-compatible endpoint (`/v1/responses`). Clients (Pi, and anything else
that speaks `anthropic-messages` or `openai-responses`) point at the relay with
a relay API key; the relay picks an account of the matching provider, shapes the
request, forwards upstream, and fails over to another account on rate limits.

> Deployment is **on-prem, VPN/physical access only**. Security posture is
> intentionally loose (no TLS, tokens at rest unencrypted). See
> [Security posture](#security-posture).

---



## Non-goals (v1)

Deliberately out of scope so the build stays bounded. Add only when a real need
names them:

- Multi-region / horizontal scale. Single node, single process.
- KMS/Vault, token encryption at rest, RBAC, per-user quotas.
- Billing/invoicing.

---



## System

```
Pi (models.json: provider "claude-relay")
   baseUrl = http://relay.local:3000   api = anthropic-messages   (no /v1: Pi's Anthropic client appends /v1/messages)
   apiKey  = <relay key>
        │  Anthropic wire payload (POST /v1/messages)
        ▼
Next.js route handler (runtime = nodejs)
   ├─ auth        verify relay key
   ├─ select      pick account (state machine, least-recently-used)
   ├─ refresh     refresh OAuth token if near expiry (single-flight per account)
   ├─ shape       shapeAnthropicOAuthPayload()   ← vendored
   ├─ forward     POST api.anthropic.com/v1/messages, bearer = account token
   ├─ stream      SSE pass-through to client
   └─ record      usage from message_delta; on error → failover / retry rules
```

`/v1/responses` follows the same pipeline with a Codex adapter: account
selection is restricted to `provider = 'openai-codex'`, the body is normalized
(see [Codex provider](#codex-provider)), and the upstream is
`POST ${CODEX_API_BASE}/codex/responses`. The loop (select → refresh → forward →
stream → record → failover) lives in `src/lib/relay-core.ts`; each provider
supplies a `RelayAdapter`.

Dashboard (same app): account CRUD, OAuth add-account flow, usage over time,
per-account rate-limit status, relay-key management.

---



## Client contract

`~/.pi/agent/models.json`:

```json
{
  "providers": {
    "claude-relay": {
      "baseUrl": "http://relay.local:3000",
      "apiKey": "<relay key from the dashboard>",
      "api": "anthropic-messages",
      "models": [
        { "id": "claude-sonnet-5-5", "name": "Sonnet 5.5 (relay)", ... },
        { "id": "claude-opus-5-5",   "name": "Opus 5.5 (relay)",   ... }
      ]
    }
  }
}
```

The relay presents the union of models the pooled accounts can serve. Model
list is curated in config; the relay does not proxy Anthropic's `/v1/models`.

Codex seats use a second provider entry. Pi's `openai-codex-responses` client
requires a ChatGPT JWT as `apiKey`, so it cannot carry a relay key; the relay is
addressed as plain `openai-responses` instead:

```json
"codex-relay": {
  "baseUrl": "http://relay.local:3000/v1",   // the OpenAI SDK appends /responses
  "apiKey": "<relay key>",                    // sent as Authorization: Bearer
  "api": "openai-responses",
  "models": [ { "id": "gpt-5.5", ... } ]
}
```

---



## Request flow

1. **Auth** — `Authorization: Bearer <relay key>`; look up `relay_keys`, reject
  if unknown or revoked.
2. **Select account** — see [Selection & affinity](#selection--affinity). A
  conversation with a live pin stays on the seat holding its warm prompt cache;
  new conversations are placed by weight; requests carrying no conversation
  signal fall back to least-recently-used. Stamp `last_selected_at` on pick.
3. **Refresh** — if `access_expires_at` < now + 5 min, refresh (see
  [OAuth lifecycle](#oauth-lifecycle)).
4. **Shape** — run the vendored `shapeAnthropicOAuthPayload()` on the parsed
  JSON body. It is idempotent and self-gating: non-Pi clients pass through
   untouched, Pi clients get the billing header + prompt sanitization.
5. **Forward** — POST to `${ANTHROPIC_API_BASE}/v1/messages` with the account's
  OAuth bearer, forwarding client headers (`anthropic-version`,
   `anthropic-beta`, `content-type`) but **overriding** `authorization`.
6. **Stream** — pipe the upstream SSE body to the client unmodified. Parse
  `message_start` / `message_delta` on the way through to capture `usage`.
7. **Record** — one `usage_events` row per request (model, tokens, status,
  latency, account, relay key).
8. **Error → failover** — see below.



### Failover rules


| Upstream result                                 | Action                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `429` (rate limited)                            | `cooldown_until = now + Retry-After` (default 60s); retry next account (bounded), repinning the conversation to the fallback seat |
| `claude_code_version_too_old`                   | rebuild billing header at the required version (vendored version-sync), retry **same** account once |
| `401` / `invalid_grant` after a refresh attempt | mark account `error`, surface in dashboard; try next account                                        |
| other `4xx`                                     | pass through to client; no failover                                                                 |
| `5xx`                                           | try next account once, then pass through                                                            |


Failover only applies **before the first byte is streamed**. Once SSE has
started, an upstream failure is surfaced to the client, not retried.

---

## Selection & affinity

Selection (`src/lib/selection.ts`) balances two goals that pull in opposite
directions: reusing prompt caches, and spreading load in proportion to each
seat's capacity.

| Request | Policy |
| --- | --- |
| Continuing a conversation (has an affinity key and a live pin) | The pinned seat, if eligible |
| New conversation (has an affinity key, no live pin) | Weighted rendezvous pick |
| No conversation signal | Least-recently-used (`last_selected_at`) |

**Affinity key** — a stable identifier for one conversation, provided by the
adapter:

- **Codex** — `body.prompt_cache_key`, which Pi already sends.
- **Anthropic** — derived in `src/lib/affinity.ts` as
  `sha256(system + tools + first user message)`. The system prompt alone is
  identical across conversations and the full message list grows every turn, so
  the first user message is the stable anchor that separates them.

**Pins** (`affinity_pins`, `src/lib/pins.ts`) record which seat a conversation
belongs to, with a TTL matching the provider cache window (5 min). Pins are what
make failover sticky: a conversation moved off a rate-limited seat stays on the
new seat after the old one recovers, instead of snapping back and discarding the
cache it just wrote.

**Weights** (`src/lib/weight.ts`) are relative, derived from the plan
(Claude Pro `1`, Max 5x `5`, Max 20x `20`, ChatGPT Plus `1`, Pro `5`), and
overridable per account from the dashboard. Weight only decides where a *new*
conversation is pinned — it never rebalances traffic already pinned, so it
cannot break an active cache.

Placement uses **weighted rendezvous hashing**: the seat maximising
`-weight / ln(hash(affinityKey, seat))` wins. Rendezvous is used rather than a
counter because the assignment must be a pure function of the key and the seat
set — two concurrent requests evaluating selection at the same instant must
agree, or a conversation's cache splits across two upstream accounts. Adding a
seat remaps only the conversations that hash toward it.

---



## Codex provider

Added alongside Anthropic; accounts carry `provider ∈ { anthropic, openai-codex }`
and `chatgpt_account_id`. Selection filters by provider, so a Codex request
never lands on a Claude seat and vice versa.

**Request normalization** (`src/lib/relay-codex.ts`, mirrors pi-ai's
`openai-codex-responses` body): allowlist of `model, instructions, input, text,
include, prompt_cache_key, tool_choice, parallel_tool_calls, temperature,
service_tier, tools, reasoning`; forces `store:false`, `stream:true`; hoists the
first `developer`/`system` input message into `instructions` (default
"You are a helpful assistant."); wraps string `input`. `stream:false` → `400`.

**Upstream headers:** `chatgpt-account-id` (account row, else JWT claim
`https://api.openai.com/auth` → `chatgpt_account_id`), `originator: pi`,
`OpenAI-Beta: responses=experimental`, `session-id` / `x-client-request-id`
from `prompt_cache_key`.

**Differences from Anthropic:**

- The Codex backend sends SSE **without** a `Content-Type`; the adapter sets
  `alwaysStreams` so any 2xx is treated (and labelled) as SSE.
- Usage comes from `response.completed|done|incomplete`. OpenAI counts cached
  tokens *inside* `input_tokens`, so the adapter stores three disjoint buckets:
  `input = input_tokens − cached` (fresh), `cache_read = cached`, and
  `cache_write = 0`. Anthropic reports the same three separately already, so
  the dashboard can total input as `input + cache_read + cache_write` for
  either provider.
- `429` cooldown uses `error.resets_at` / `resets_in_seconds` (hours for the
  5h/weekly windows), falling back to `Retry-After`.
- `401` marks the account `error` and fails over (`failoverOn401`).

**OAuth:** authorization-code + PKCE against `auth.openai.com`, redirect
`http://localhost:1455/auth/callback`, a separate temporary listener on `:1455`
(Anthropic keeps `:53692`). Pending logins are keyed by provider + `state`.

---



## Account model

`state ∈ { active, cooling, disabled, error }`.

```
active   → eligible; on 429 → cooling; on auth failure → error
cooling  → ineligible until cooldown_until; auto-returns to active
error    → ineligible; requires admin action (re-login / enable) to clear
disabled → ineligible; admin-set
```

`last_error` carries the reason shown in the dashboard.

---



## OAuth lifecycle

Login and refresh are **not** inherited from upstream (`pi-anthropic-auth`
delegates them to Pi's runtime). The relay owns them, ported from
`@earendil-works/pi-ai`'s OAuth module — see [UPSTREAM.md](./UPSTREAM.md).

**Add account (PKCE, admin, once per seat):**

1. Admin starts a login in the dashboard; relay builds the authorize URL + PKCE
  verifier and starts a temporary listener on `:53692`.
2. Anthropic redirects the *browser* to `http://localhost:53692/callback` (the
  only redirect the client is registered for — it can't point at the relay).
  If the browser can reach the listener (same host, a port-forwarded host, or
  `ssh -L`), the relay completes the login itself; otherwise the admin pastes
  the redirect URL into the dashboard.
3. Relay exchanges code → access + refresh tokens, stores them, then calls
  `GET /api/oauth/profile` to populate plan/seat/rate-limit fields.
4. PKCE state is held **in memory** (single node, rare admin action, short
  window). A restart mid-login just means retry.

**Refresh (per request, single-flight):**

- Triggered when `access_expires_at` < now + 5 min.
- **Single-flight per account**: concurrent requests that observe the same
expiry trigger exactly one refresh; the rest await its result. A refresh
stampede can rotate the refresh token into invalidity and log the account out
— this is the highest-risk correctness path in the system.
- Refresh failure marks the account `error` and triggers failover.

---



## Shaping (vendored)

The Claude Code OAuth request shaping is **copied** from
`gotgenes/pi-anthropic-auth` (MIT) into `src/lib/shaping/` and adapted
(env-var prefix `PI_ANTHROPIC_AUTH_*` → `RELAY_*`). It is not reimplemented:
the billing-header recipe and prompt-sanitization triggers are empirically
discovered and fail *silently* as a misleading `400 "You're out of extra usage"`. See [UPSTREAM.md](./UPSTREAM.md) for the file list and sync procedure.

Applied unconditionally — `shapeAnthropicOAuthPayload()` no-ops on non-Pi
payload shapes and skips already-shaped blocks.

---



## Data model

SQLite (WAL mode), migrated with **dbmate**. Raw SQL, no ORM.

- **accounts** — see [db/migrations](./db/migrations). Holds tokens + plan
profile + state machine fields (`state`, `cooldown_until`, `last_selected_at`)
+ `provider`, `chatgpt_account_id` and `weight` (NULL = derive from plan).
- **affinity_pins** — one row per conversation, mapping its affinity key to the
seat holding its warm prompt cache (see [Selection & affinity](#selection--affinity)).
- **relay_keys** — the shared secrets clients send. Plaintext (perimeter is the
VPN). `revoked_at` for soft revoke.
- **usage_events** — one row per relayed request; the dashboard aggregates it.

Schema lives in versioned `.sql` migrations; see `db/migrations/`.

---



## Config (env)


| Var                         | Purpose                               | Default                     |
| --------------------------- | ------------------------------------- | --------------------------- |
| `DATABASE_URL`              | dbmate + app SQLite path              | `sqlite:/data/relay.db`     |
| `RELAY_ADMIN_PASSWORD`      | dashboard login                       | — (required)                |
| `ANTHROPIC_API_BASE`        | upstream base                         | `https://api.anthropic.com` |
| `CODEX_API_BASE`            | Codex upstream base (`/codex/responses` appended) | `https://chatgpt.com/backend-api` |
| `RELAY_CLAUDE_CODE_VERSION` | billing-header version pin (vendored) | bundled `2.1.280`           |
| `RELAY_DEBUG`               | shaping debug logs                    | off                         |
| `PORT`                      | listen port                           | `3000`                      |


No secret is inlined at build time; all read at runtime.

---



## Deployment

- Single long-running Node process, managed by [pm2](https://pm2.keymetrics.io)
  (`ecosystem.config.cjs`).
- SQLite file on local disk.
- No TLS, no reverse proxy required, no separate DB service.
- Migrations run on start (`dbmate up`) before the server binds.

---



## Observability

- Structured JSON logs: `request_id`, `account_id`, `model`, `status`,
`latency_ms`, `tokens`. **Tokens and relay keys are redacted** (logs get
pasted into issues/docs).
- `/health` — liveness + DB reachable + count of `active` accounts.
- Dashboard: per-account state, cooldown, plan tier, usage over time.

---



## Testing

- **Shaping** — ported golden fixtures from upstream (`request-shaping`,
`billing-header`, `system-prompt-shaping`) run against the vendored copy.
- **Refresh** — N concurrent callers on an expiring token issue exactly 1
refresh.
- **Failover** — mocked upstream returning `429`, `version_too_old`, `5xx`
drives the documented transitions.
- **Relay (Anthropic)** — characterization tests (`test/relay-anthropic.test.ts`)
pin the pre-refactor behavior, including usage merging across SSE events.
- **Relay (Codex)** — mocked backend: body normalization, headers, usage,
`resets_at` cooldown, 401/429/5xx failover, provider isolation.
- **Relay** — end-to-end against a real pooled account (manual/integration).

---



## Build phases

```
0. Foundations       Next.js + dbmate + SQLite + env + /health   → builds, /health ok, migration runs
1. Vendored shaping  copy 9 files, rename env prefix            → ported upstream tests pass
2. OAuth + store     PKCE login, tokens, single-flight refresh  → refresh concurrency test = 1
3. Relay endpoint    /v1/messages, auth, shaping, SSE, usage    → real account round-trips + golden
4. Failover          state machine, cooldown, retries           → mocked 429/version/5xx tests pass
5. Dashboard + obs   accounts CRUD, usage, logs, /health        → usage rows recorded
6. Deploy + docs     multi-arch image, UPSTREAM.md, sync script → clean clone → build → serve
```

---



## Security posture

On-prem, VPN/physical access only. Deliberately loosened:

- No TLS (plain HTTP on the LAN).
- OAuth tokens stored **unencrypted** at rest.
`ponytail: tokens plaintext; add AES-GCM + key from env if this ever leaves the LAN`
- Relay keys stored plaintext, not hashed.
- Single shared admin password.

Kept regardless, because they are correctness not perimeter:

- **Single-flight refresh** — a stampede can invalidate the refresh token.
- **Token redaction in logs** — logs are shared outside the perimeter.

