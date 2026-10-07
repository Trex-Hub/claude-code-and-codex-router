# Affinity- and weight-aware load balancing

## Problem

`relayWithFailover` currently selects accounts least-recently-used
(`eligibleAccounts` orders by `last_selected_at`). With N seats this alternates
traffic across all of them, which destroys provider-side prompt caching: a
conversation's second turn has a ~1/N chance of landing on the seat that holds
its warm prefix, so the cache is written repeatedly and never reused.

There is also no notion of capacity. A Claude Max 5x seat should absorb roughly
5× the load of a Claude Pro seat; today both get identical traffic.

## Design

Two concerns, deliberately separated:

- **Affinity** routes *continuing* conversations back to the seat holding their
  warm cache.
- **Weight** decides where *new* conversations get pinned, in proportion to seat
  capacity.

Weight never rebalances existing traffic. It only selects the pin for a
conversation that has none. That is what preserves cache hits while still
letting a Max seat take proportionally more load.

### 1. Affinity key

Produced by the adapter, one per request. Stable across the turns of one
conversation, distinct between conversations.

- **Codex**: `body.prompt_cache_key` — already extracted at
  `src/lib/relay-codex.ts:183`.
- **Anthropic**: derived in `src/lib/relay.ts` as
  `sha256(system prompt + tools + first user message)`. The growing message list
  cannot be used (it changes every turn) and the system prompt alone cannot
  (it is identical across conversations).

No client change is required for either provider.

### 2. Pin store

New table `affinity_pins(affinity_key PK, account_id, provider, expires_at)`.

On each request:

1. Look up the pin. If it exists, is unexpired, and its account is eligible →
   use that account.
2. Otherwise select by weight (§3) and write a new pin.

Pins are what make failover sticky: without them, a 429 that moves a
conversation to seat B would snap back to seat A as soon as A's cooldown expired,
discarding B's now-warm cache. TTL matches the provider cache window (5 min for
Anthropic; Codex's window is not documented, so a conservative default is used).

### 3. Weighted selection (new sessions only)

Weight is static and plan-derived, and editable per account:

| Plan | Default weight |
| --- | --- |
| Claude Pro | 1 |
| Claude Max 5x | 5 |
| Claude Max 20x | 20 |
| ChatGPT Plus | 1 |
| ChatGPT Pro | 5 (unverified — confirm against a real seat) |

Derived from the same plan fields the dashboard already reads
(`organization_type` / `plan_tier` / `rate_limit_tier`), so no new upstream data
is needed. Selection uses **weighted rendezvous hashing** — each account is
scored by `hash(affinity_key, account_id) / weight` and the highest score wins.

Rendezvous hashing is chosen over an incrementing counter for a specific reason:
a conversation must land on the *same* seat even if two instances of the relay
or two concurrent requests evaluate the selection at the same moment. A counter
would allocate them differently and split the cache. Rendezvous is a pure
function of (affinity_key, account set), so concurrent requests agree, and
adding a third account remaps only the conversations that hash toward it.

### 4. Escape hatch

If the pinned seat is overloaded (cooling, in-flight cap reached, or reported
headroom exhausted), break affinity and repin. Without this, stickiness creates
hotspots. Minimal first version: break affinity when the pinned account is not
`active` (already the eligibility check). Per-seat in-flight caps are a later
addition.

### 5. Concurrency fix

Selection is currently a `SELECT` followed by `touchSelected`, with no locking,
so parallel requests can read the same `last_selected_at` and pick the same
account. This already drifts away from alternation under load and will be worse
with weights. Fold an atomic claim into this work.

## Non-goals

- Dynamic headroom weighting from rate-limit headers. Static plan weights were
  chosen deliberately; the codex `x-codex-primary-used-percent` /
  `secondary-used-percent` headers remain unused.
- Cross-provider balancing. Affinity and weights are scoped per provider.
- Prefix-token radix-tree routing. Overkill at this fleet size; the client
  already keeps the cacheable prefix stable and first.

## Tasks

1. **Weights** — add `weight` to the accounts table (migration + schema), default
   derived from plan, editable via the dashboard, and expose `planWeight()`.
2. **Pin store** — `affinity_pins` table (migration + schema), lookup/claim/
   expire helpers, and a TTL constant.
3. **Selection** — add `affinityKey` to the adapter interface and the
   `relayWithFailover` context; implement weighted rendezvous selection with
   pin preference; make the claim atomic.
4. **Keys** — extract `prompt_cache_key` in the Codex adapter; derive the
   Anthropic hash in the messages adapter.
5. **Tests** — affinity sticks across turns; a 429 repins and the pin survives
   the original seat's recovery; weights approximate the plan ratios over many
   fresh conversations; concurrent selections agree on the same seat; an
   expired pin re-selects.
6. **Docs** — README (routing behaviour, weight field) and ARCHITECTURE
   (selection algorithm, pin table).

## Verification

- Unit tests per provider for key extraction and pin behaviour.
- A simulation test over N synthetic conversations asserting the weight ratio
  lands within tolerance and that cache-eligible repeat turns reuse the pin.
- Live check against the real pool: confirm a multi-turn Pi conversation stays on
  one seat (visible via `usage_events.account_id`).
