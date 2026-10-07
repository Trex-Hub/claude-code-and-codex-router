import { randomUUID } from "node:crypto";
import type { Provider } from "../accounts";

/**
 * In-memory store of in-progress OAuth logins.
 *
 * Single node, rare admin action, short window — a process restart mid-login
 * just means retry. See ARCHITECTURE.md.
 */
export interface PendingLogin {
  id: string;
  provider: Provider;
  label: string;
  verifier: string;
  /** The OAuth `state` the redirect must echo back. */
  state: string;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;

/** Result of a login finished by the callback listener, for the dashboard to poll. */
export type LoginOutcome =
  | { status: "complete" }
  | { status: "error"; message: string };

declare global {
  // eslint-disable-next-line no-var
  var __claudeRelayPending: Map<string, PendingLogin> | undefined;
  // eslint-disable-next-line no-var
  var __claudeRelayOutcomes: Map<string, LoginOutcome & { at: number }> | undefined;
}

function outcomes(): Map<string, LoginOutcome & { at: number }> {
  if (!globalThis.__claudeRelayOutcomes) {
    globalThis.__claudeRelayOutcomes = new Map();
  }
  return globalThis.__claudeRelayOutcomes;
}

function store(): Map<string, PendingLogin> {
  if (!globalThis.__claudeRelayPending) {
    globalThis.__claudeRelayPending = new Map();
  }
  return globalThis.__claudeRelayPending;
}

function reap(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, pending] of store()) {
    if (pending.createdAt < cutoff) store().delete(id);
  }
  for (const [id, outcome] of outcomes()) {
    if (outcome.at < cutoff) outcomes().delete(id);
  }
}

export function startPending(
  label: string,
  verifier: string,
  provider: Provider = "anthropic",
  /** Anthropic's flow uses the PKCE verifier as `state`. */
  state: string = verifier,
): string {
  reap();
  const id = randomUUID();
  store().set(id, {
    id,
    provider,
    label,
    verifier,
    state,
    createdAt: Date.now(),
  });
  return id;
}

/** Removes and returns a pending login (single use). */
export function takePending(id: string): PendingLogin | undefined {
  reap();
  const pending = store().get(id);
  if (pending) store().delete(id);
  return pending;
}

export function hasPending(id: string): boolean {
  reap();
  return store().has(id);
}

export function pendingCount(provider?: Provider): number {
  reap();
  if (!provider) return store().size;
  return [...store().values()].filter((p) => p.provider === provider).length;
}

/** Removes and returns the pending login whose OAuth `state` matches (single use). */
export function takePendingByState(
  provider: Provider,
  state: string,
): PendingLogin | undefined {
  reap();
  for (const pending of store().values()) {
    if (pending.provider === provider && pending.state === state) {
      return takePending(pending.id);
    }
  }
  return undefined;
}

export function recordOutcome(id: string, outcome: LoginOutcome): void {
  outcomes().set(id, { ...outcome, at: Date.now() });
}

export function getOutcome(id: string): LoginOutcome | undefined {
  reap();
  const outcome = outcomes().get(id);
  if (!outcome) return undefined;
  const { at: _at, ...rest } = outcome;
  return rest;
}
