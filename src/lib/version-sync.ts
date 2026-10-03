import { createBillingVersionSync } from "./shaping/billing-version-sync";
import { createLearnedClaudeCodeFloor } from "./shaping/claude-code-version";

/**
 * Process-wide Claude Code version floor learned from Anthropic's
 * `claude_code_version_too_old` rejections.
 *
 * Shared across all requests so a raised floor is paid for once (see
 * `billing-version-sync.ts`). One instance per process, per ARCHITECTURE.md.
 */
declare global {
  // eslint-disable-next-line no-var
  var __claudeRelayLearnedFloor:
    | ReturnType<typeof createLearnedClaudeCodeFloor>
    | undefined;
}

export function learnedFloor(): ReturnType<typeof createLearnedClaudeCodeFloor> {
  if (!globalThis.__claudeRelayLearnedFloor) {
    globalThis.__claudeRelayLearnedFloor = createLearnedClaudeCodeFloor();
  }
  return globalThis.__claudeRelayLearnedFloor;
}

/** A per-request version sync that wraps the fetch to Anthropic. */
export function newVersionSync(
  baseFetch?: typeof fetch,
): ReturnType<typeof createBillingVersionSync> {
  return createBillingVersionSync(learnedFloor(), baseFetch);
}
