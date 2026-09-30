# Changelog

All notable changes to molt. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] — 2026-09-30

The public release — the tool as it runs in production against a very full Pixel 9 Pro XL.

### Added
- Hybrid transfer engine: per-directory tar-pull vs parallel-pull selection from live stats (`src/pull.ts`)
- SQLite incremental manifest with batched on-device stat (`src/manifest.ts`)
- Real `verify` (archive vs manifest) and guarded `clean` (verify-first, `--yes`, photo dirs exempt)
- Event-driven Syncthing arrival classifier with pure, unit-tested routing (`src/classifier.ts`, `tests/classifier.test.ts`)
- Wireless-ADB endpoint discovery (port rotates; re-discovered every run)
- Zero-dependency bootstrap `bin/fast-pull.sh` and the 8-method `bin/speed-race.sh` shootout
- Docs: benchmarks, toybox quirk, manifest schema, Syncthing roadmap, safety rules

### Benchmarked
- Small files: on-device tar + single pull wins at ~29 MB/s (vs ~8 MB/s plain pull)
- Large files: plain `adb pull` wins at ~44 MB/s; `-z` never wins on incompressible data
- `exec-out` pipes lose to framing overhead (~9 MB/s) — don't use them
