# Safety

molt moves *your* files off *your* phone onto *your* server. The phone is a daily driver, so the tool is conservative by default.

## Hard rules

- **Photos are out of scope.** `DCIM/` and `Pictures/` are never in the default source list, the classifier never auto-routes photo/video files, and `clean` refuses photo dirs even if you add them to `MOLT_SOURCES`.
- **No destructive phone-side step without a verified manifest.** `clean` runs `verify` first and aborts on any mismatch. Then it still needs `--yes`.
- **No app/package operations.** No `pm clear`, no uninstalls, no cache wipes. molt touches files under `/sdcard` only.
- **Credential-shaped content is quarantined, not sorted.** If a docs-bound file looks like it contains keys, passwords, or tokens, the classifier moves it to `quarantine/` instead of `docs/`.

## The rules in code

| Command | Guard |
|---|---|
| `pull` | read-only on the phone (plus temp tarballs for tar-pull, cleaned up both ends) |
| `verify` | read-only everywhere |
| `clean` | requires `verify` clean + `--yes`; skips `DCIM`/`Pictures` unconditionally |
| `classifier` | never deletes; unknown files stay in `incoming/` |

## Before you `clean`

1. `bun src/index.ts verify <dest>` — must report clean.
2. Spot-check: open a few archives, compare sizes against the text manifest.
3. Then `bun src/index.ts clean --yes <dest>`.

The archive is the only copy after a clean. Keep it safe.
