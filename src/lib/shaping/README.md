# Vendored shaping

This directory is **copied** from [`gotgenes/pi-anthropic-auth`](https://github.com/gotgenes/pi-anthropic-auth)
(MIT — see `LICENSE.pi-anthropic-auth`), pinned to commit `2519b6c` (v3.4.3).

It is not reimplemented on purpose: the Claude Code billing-header recipe and
the system-prompt sanitization are empirically discovered and fail *silently*
(a misleading `400 "You're out of extra usage"`) when they drift. See
[`../../UPSTREAM.md`](../../UPSTREAM.md) for the full list, the sync procedure,
and the symptom→source map.

## Files copied

```
anthropic-message.ts  billing-header.ts  billing-version-sync.ts
claude-code-version.ts  constants.ts  debug.ts  request-shaping.ts
system-prompt-sections.ts  system-prompt-shaping.ts  version-rejection.ts
```

Upstream files that depend on the Pi runtime (`index.ts`, `oauth-transport.ts`,
`host-transport.ts`, `diagnostics.ts`, `extension-config.ts`,
`extra-provider-shaping.ts`, `account-profile.ts`) are **not** copied.

## Adaptations from upstream

- `PI_ANTHROPIC_AUTH_DEBUG` → `RELAY_DEBUG` (`debug.ts`).
- `PI_ANTHROPIC_AUTH_CLAUDE_CODE_VERSION` → `RELAY_CLAUDE_CODE_VERSION`
  (`claude-code-version.ts`).
- `billing-version-sync.ts`: pi-ai's type-only `FetchFunction` import replaced
  with a local type alias so `@earendil-works/pi-ai` is not a dependency.

Entry point: `shapeAnthropicOAuthPayload()` in `request-shaping.ts`.
