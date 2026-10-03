import { randomUUID } from "node:crypto";

/**
 * In-memory store of in-progress OAuth logins.
 *
 * Single node, rare admin action, short window — a process restart mid-login
 * just means retry. See ARCHITECTURE.md.
 */
export interface PendingLogin {
  id: string;
  label: string;
  verifier: string;
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __claudeRelayPending: Map<string, PendingLogin> | undefined;
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
}

export function startPending(label: string, verifier: string): string {
  reap();
  const id = randomUUID();
  store().set(id, { id, label, verifier, createdAt: Date.now() });
  return id;
}

/** Removes and returns a pending login (single use). */
export function takePending(id: string): PendingLogin | undefined {
  reap();
  const pending = store().get(id);
  if (pending) store().delete(id);
  return pending;
}
