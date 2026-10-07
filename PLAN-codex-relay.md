# Plan — ChatGPT Codex subscription pool (`/v1/responses`)

Add a second provider to the relay: pool ChatGPT/Codex subscription seats behind
an OpenAI **Responses**-compatible endpoint, for Pi (`api: "openai-responses"`).
Reuses everything provider-agnostic: account state machine, cooldowns,
single-flight refresh, relay keys, usage table, dashboard.

## Client contract

`~/.pi/agent/models.json`:

```json
"codex-relay": {
  "baseUrl": "http://relay.local:3000/v1",
  "apiKey": "<relay key>",
  "api": "openai-responses",
  "models": [{ "id": "gpt-5.x-codex", ... }]
}
```

- Pi must use `openai-responses`, **not** `openai-codex-responses`: the latter
  decodes `apiKey` as a ChatGPT JWT to read `chatgpt_account_id` and throws on a
  relay key.
- The OpenAI SDK appends a hard-coded `/responses` to `baseUrl`, so the client
  hits `POST /v1/responses`. No rewrite needed (a no-`/v1` baseUrl was
  considered and rejected: cosmetic only).
- Auth: SDK sends `Authorization: Bearer <relay key>` (already handled by
  `extractKey`).

## Upstream request (what the relay sends)

`POST https://chatgpt.com/backend-api/codex/responses` (SSE), source of truth is
`@earendil-works/pi-ai` `api/openai-codex-responses.js` (pi-ai 1.0.4):

- Headers: `Authorization: Bearer <access>`, `chatgpt-account-id`,
  `originator: pi`, `OpenAI-Beta: responses=experimental`,
  `accept: text/event-stream`, `content-type: application/json`,
  `session-id` + `x-client-request-id` (from `prompt_cache_key`), a `User-Agent`.
- Body: `store:false`, `stream:true`, `instructions` (required, default
  `"You are a helpful assistant."`), `input`, `text`, `include`,
  `prompt_cache_key`, `tool_choice`, `parallel_tool_calls`, optional
  `temperature`, `service_tier`, `tools`, `reasoning`.
- OAuth: client `app_EMoamEEZ73f0CkXaXp7hrann`, `auth.openai.com/oauth/{authorize,token}`,
  callback port **1455** (shared with the Codex CLI — paste fallback needed).

---

## Task 1 — Provider-aware accounts (≈ 2 h)

Foundation; no behaviour change for existing Anthropic accounts.

- New dbmate migration `…_add_provider.sql`:
  `ALTER TABLE accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic'`,
  `ADD COLUMN chatgpt_account_id TEXT`; index on `(provider, state)`. Regenerate
  `db/schema.sql`.
- `accounts.ts`: `Account` / `AccountRow` / `NewAccount` gain `provider`,
  `chatgptAccountId`; `createAccount` takes `provider`;
  `eligibleAccounts(provider, excludeIds)` filters by provider; `publicAccount`
  exposes `provider`.
- Update callers (`relay.ts` passes `"anthropic"`).
- `test/setup.ts`: apply **all** migrations in order (today it only loads init).
- Tests: `eligibleAccounts("anthropic")` never returns a codex account and vice
  versa; existing `accounts.test.ts` still green.

**Done when:** `pnpm test` + `pnpm typecheck` pass; existing Anthropic relay path
unchanged.

## Task 2 — OpenAI Codex OAuth: login + refresh + dashboard (≈ 4–5 h)

Port from `pi-ai` `auth/oauth/openai-codex.js` into `src/lib/oauth/openai-codex.ts`
(record in `UPSTREAM.md` §2). Re-read the file for exact scope/redirect/originator
values before coding — do not guess them.

- `openai-codex.ts`: `buildAuthorizeUrl`, `exchangeCode`, `refreshTokens`,
  `parseManualInput`, `extractAccountId(jwt)` (claim
  `https://api.openai.com/auth` → `chatgpt_account_id`), plus plan type from the
  same JWT for display.
- Generalize the login plumbing (currently Anthropic-shaped):
  - `pending.ts`: `PendingLogin` gets `provider` and a separate `state`
    (Anthropic uses the verifier as state; OpenAI uses its own random state).
  - `callback-server.ts`: listener per provider (port + path: `53692 /callback`
    vs `1455 /auth/callback`); if 1455 is taken, skip and rely on paste.
  - `complete.ts`: dispatch on `pending.provider`; Codex path stores
    `chatgpt_account_id` and plan, no `fetchProfile`.
  - `POST /api/accounts` accepts `provider` (default `anthropic`), label default
    per provider.
- `refresh.ts`: dispatch `refreshTokens` by provider; keep the single-flight map
  as is (OpenAI refresh tokens rotate too). On refresh, re-derive
  `chatgpt_account_id`.
- `Dashboard.tsx`: provider selector on Add Account; show provider badge and
  plan on each card; usage view unchanged.
- Tests: JWT account-id extraction; authorize URL params; `refresh.test.ts`
  extended — N concurrent callers on an expiring **codex** account → exactly 1
  refresh; callback listener test for the new port/path.

**Done when:** a real Codex seat can be added from the dashboard (via listener
and via paste) and its token refreshes.

## Task 3 — `/v1/responses` relay (≈ 5–6 h) — the core

- Extract the provider-agnostic failover loop out of `relay.ts` into
  `relayWithFailover({ provider, prepare, usageFrom })` so Anthropic and Codex
  share account selection, refresh, 429 cooldown, 5xx retry-once, and
  usage recording. `handleMessages` becomes a thin wrapper — **its tests must
  pass unchanged** (this is the regression guard).
- New `src/lib/relay-codex.ts` (`handleResponses`):
  - parse JSON body; reject non-JSON with 400.
  - **normalize** body: force `store:false`, `stream:true`; default
    `instructions`; drop fields the Codex backend doesn't accept
    (`max_output_tokens`, `prompt_cache_retention`, `prompt_cache_options`,
    …). Prefer an allowlist mirroring pi-ai's codex body (list above) over a
    denylist.
  - headers per the table above; `chatgpt-account-id` from the account row;
    `session-id` from `prompt_cache_key`.
  - upstream base from new env `CODEX_API_BASE`
    (default `https://chatgpt.com/backend-api`), mirrored in `.env.example` and
    the ARCHITECTURE config table.
  - usage: parse `response.completed` → `response.usage`
    (`input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`).
  - 429: read the body for the usage-limit reset (pi-ai parses
    `usage_limit_reached` ≈ line 1250) and set cooldown to that reset instead of
    the 60 s default; fall back to `Retry-After`.
  - 401 after refresh → mark `error`, try next account (same rule as Anthropic).
- `src/app/v1/responses/route.ts`: auth via shared `extractKey` (move it from
  the messages route into `relay-keys.ts`), then `handleResponses`.
- Tests (mocked upstream): body normalization golden; headers; 429 → cooldown
  and failover to second account; 5xx; `store`/`stream` forced; usage recorded
  from SSE; Anthropic account never picked for `/v1/responses`.

**Done when:** mocked tests green and Anthropic suite untouched.

## Task 4 — Live verification + docs (≈ 2–3 h)

- Manual E2E with one real Codex seat: `curl` the SSE directly, then Pi with the
  `codex-relay` provider above (plain turn, tool call, reasoning effort, long
  conversation for prompt-cache). Fix any field the backend rejects and add it to
  the normalization test as a regression.
- Failover E2E with two seats (force a cooldown on one).
- Confirm usage rows + dashboard numbers for Codex.
- Docs: `ARCHITECTURE.md` (system diagram, client contract, request flow,
  config, data model), `UPSTREAM.md` (Codex OAuth + body-shape source, symptom
  map rows), `README.md` (add-Codex-seat steps, `models.json` snippet),
  `.env.example`.

**Done when:** Pi completes real turns through the relay and docs match the code.

---

## Risks / open points

- Codex backend field strictness is only known from pi-ai's source, not tested
  live — Task 4 is where surprises land; budget for it.
- `originator: pi` / `User-Agent` identify the traffic as Pi. Keep them as pi-ai
  sends them; this is the empirically working shape.
- Port 1455 collides with a local Codex CLI login (same dev box). Paste fallback
  must work.
- pi-ai's OAuth API churns; Codex constants may move (see `UPSTREAM.md`).
- Non-streaming clients are unsupported: the backend only streams, and we force
  `stream:true`. Fine for Pi.

**Total ≈ 2 working days.** Order is strict: 1 → 2 → 3 → 4 (3 can start against
a hand-inserted account row once 1 is done).
