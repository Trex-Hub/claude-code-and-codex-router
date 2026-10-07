import { createHash } from "node:crypto";
import { touchSelected, type Account, type Provider } from "./accounts";
import { eligibleAccounts } from "./accounts";
import { effectiveWeight } from "./weight";
import { deletePin, getPin, reapPins, setPin } from "./pins";

/**
 * Deterministic hash of a (key, account) pair as a value in (0, 1).
 *
 * Rendezvous hashing needs the assignment to be a pure function of the key and
 * the account id: two concurrent requests carrying the same affinity key must
 * agree on a seat even when they evaluate selection at the same moment. A
 * counter (or `last_selected_at`) would allocate them differently and split the
 * conversation's prompt cache across two upstream accounts.
 */
function hashUnit(affinityKey: string, accountId: string): number {
  const digest = createHash("sha256")
    .update(affinityKey)
    .update("\0")
    .update(accountId)
    .digest();
  // First 48 bits, shifted off zero so the result is strictly inside (0, 1).
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i];
  return (n + 0.5) / 2 ** 48;
}

/**
 * Picks the account for one request, excluding `tried`.
 *
 * Affinity wins over balance: if the conversation has a live pin and that seat
 * is eligible, it is returned unchanged so its warm prompt cache is reused.
 * Only conversations without a usable pin are placed by weight.
 *
 * A conversation that carries no affinity key at all has nothing to keep
 * cached together, so it falls back to the old least-recently-used spread.
 *
 * `tried` accounts are ineligible by definition, so a pin on a rate-limited
 * seat naturally falls through to a fresh weighted pick, which then replaces
 * the pin — keeping the conversation on the new seat after it recovers rather
 * than snapping back and discarding the new cache.
 */
export function selectAccount(
  provider: Provider,
  affinityKey: string | null,
  tried: string[] = [],
): Account | undefined {
  reapPins();
  const candidates = eligibleAccounts(provider, tried);
  if (candidates.length === 0) return undefined;

  if (!affinityKey) {
    // No conversation signal means nothing to keep cached together, so the
    // cheapest useful policy is the old least-recently-used spread.
    const account = candidates[0];
    if (account) touchSelected(account.id);
    return account;
  }

  const pinnedId = getPin(affinityKey, provider);
  if (pinnedId) {
    const pinned = candidates.find((a) => a.id === pinnedId);
    // A pin on a seat that is disabled/cooling/already-tried is stale.
    if (pinned) {
      touchSelected(pinned.id);
      return pinned;
    }
    deletePin(affinityKey);
  }

  const winner = weightedPick(candidates, affinityKey);
  if (winner) {
    setPin(affinityKey, provider, winner.id);
    touchSelected(winner.id);
  }
  return winner;
}

/**
 * Weighted rendezvous selection (WRH): the seat maximising `-weight / ln(h)`
 * wins, where `h` is the deterministic hash of (key, seat).
 *
 * This is the standard weighted-rendezvous formula: because `ln(h) < 0`, the
 * score rises with weight, so a heavier seat wins proportionally more keys
 * while the assignment stays a pure function of the key and the seat set.
 * Dividing the hash by the weight instead would invert the effect.
 */
function weightedPick(
  candidates: Account[],
  affinityKey: string,
): Account | undefined {
  let best: Account | undefined;
  let bestScore = -Infinity;
  for (const account of candidates) {
    const weight = effectiveWeight(account);
    const s = -weight / Math.log(hashUnit(affinityKey, account.id));
    if (s > bestScore) {
      bestScore = s;
      best = account;
    }
  }
  return best;
}
