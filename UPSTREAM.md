# UPSTREAM — where the inherited logic comes from

This relay inherits two pieces of empirically-derived logic that we **copy, not
reimplement**. Reverse-engineering them is unnecessary and error-prone: they
change silently and fail as misleading errors.

## 1. Request shaping

- **Repo:** https://github.com/gotgenes/pi-anthropic-auth
- **License:** MIT (preserve the upstream copyright header on every copied file)
- **Pinned:** commit `f648e81` (v3.4.2)
- **Reference checkout (throwaway, gitignored):**

  ```bash
  git clone https://github.com/gotgenes/pi-anthropic-auth.git ant-auth
  ```

  `ant-auth/` is only a reference while developing. It is listed in
  `.gitignore` and is **deleted once the shaping files are vendored**. To update
  the reference, delete it and re-clone, or `git -C ant-auth pull`.

### Vendored files → `src/lib/shaping/`

```
billing-header.ts          claude-code-version.ts   constants.ts
system-prompt-sections.ts  system-prompt-shaping.ts request-shaping.ts
version-rejection.ts       debug.ts                 anthropic-message.ts
billing-version-sync.ts
```

Entry point: `shapeAnthropicOAuthPayload(payload)`.

Pi-coupled files **not** vendored (they need the Pi runtime):
`index.ts`, `oauth-transport.ts`, `host-transport.ts`, `diagnostics.ts`,
`extension-config.ts`, `extra-provider-shaping.ts`, `account-profile.ts`.

### Adaptations applied to the vendored copy

- Env prefix `PI_ANTHROPIC_AUTH_*` → `RELAY_*`.
- (Optional) strip Pi-prompt-only assumptions. Not required — the function is
  idempotent and self-gating.

## 2. OAuth login + refresh

Upstream does **not** contain this — it delegates to Pi's runtime. Port from:

- **Package:** `@earendil-works/pi-ai`, OAuth module
- Note: its API churns (upstream removed `loginAnthropic`/`refreshAnthropicToken`
  in 0.80.8). Track it when refresh/login breaks.

## Symptom → source map

When something breaks, start here:

| Symptom | Check |
|---|---|
| `400` … "You're out of extra usage" | `src/lib/shaping/billing-header.ts` — the recipe moved |
| `claude_code_version_too_old` / "does not support this model" | `claude-code-version.ts` + `billing-version-sync.ts` |
| `/compact` or turn blocked as ToS / "reverse engineering" | `system-prompt-shaping.ts` — new classifier trigger phrase |
| Pi updated its system-prompt structure | re-sync `system-prompt-sections.ts` (upstream has `test/upstream-prompt-drift.test.ts`) |
| Login / token refresh fails | pi-ai OAuth module (see §2) |

## Sync procedure

1. Delete and re-clone the reference (or `git -C ant-auth pull`).
2. Diff the vendored files against the upstream versions.
3. Re-apply the adaptations (env prefix rename).
4. Run the ported shaping tests before committing.
5. Update the pinned commit hash above.
