# Contributing to molt

## Ground rules

- **Benchmarks beat opinions.** If you want to change the transfer path, run `./bin/speed-race.sh` first and bring numbers. The hybrid strategy exists because it won a shootout.
- **New code is Bun/TypeScript.** Shell stays for the zero-dependency bootstrap (`bin/`); everything else is Bun.
- **Tests for routing logic.** The classifier's `routeFor` is pure — add a case to `tests/classifier.test.ts` for every new rule.
- **Safety rules are load-bearing.** Photos are never auto-routed, `clean` needs verify + `--yes`. Don't weaken these without a very good reason.

## Workflow

1. Fork, branch, commit.
2. `bun install && bun test` — all green.
3. `shellcheck bin/*.sh` — clean.
4. Open a PR against `main` with the template filled in.

## What needs work

- More `routeFor` cases (uncommon archive formats, more credential shapes).
- Syncthing pairing guide with screenshots for the Android app.
- Windows/macOS ADB notes (developed and tested on Linux).
- `verify` hash checks (currently size-based; opt-in sha256 per file).
