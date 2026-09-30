# slough 🪶

[![CI](https://github.com/toxicwind/slough/actions/workflows/ci.yml/badge.svg)](https://github.com/toxicwind/slough/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/toxicwind/slough)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.2-black?logo=bun)](https://bun.sh)

**Shed the weight off your Android phone.** slough is a benchmarked, hybrid ADB backup tool: it pulls your phone's bulk — downloads, documents, repos, exports — to your own server over wireless ADB, as fast as the wire allows, with SQLite incremental manifests so the second run only fetches what changed.

Built for my own Pixel 9 Pro XL, which sat at 99% full (225G of 229G). One command, 26 GB off the phone, every file accounted for.

## The 10-second version

```bash
bun install
bun src/index.ts pull /mnt/8TB/phone-archive
```

That's it. slough discovers your phone over wireless ADB (the port rotates — slough re-discovers it every run), stats each source dir, picks the fastest transfer method **per directory**, and writes a manifest. Run it again tomorrow: only changed files move.

No dependency? Use the zero-dependency bootstrap instead:

```bash
./bin/fast-pull.sh /mnt/8TB/phone-archive
```

## Why not just `adb pull`?

Because `adb pull` is slow in exactly the way that matters. I raced 8 transfer methods against real payloads (1000×100KB files + one 300MB blob) and the winner depends on the shape of the data:

| Payload | Method | Throughput |
|---|---|---|
| 1000 small files (131 MB) | on-device `tar` → pull one tarball | **~29 MB/s** |
| 1000 small files (131 MB) | 8-way parallel `adb pull` | ~20 MB/s |
| 1000 small files (131 MB) | plain `adb pull` | ~8 MB/s |
| 300 MB blob | plain `adb pull` | **~44 MB/s** |
| 300 MB blob | `adb pull -z` (compressed) | ~40 MB/s |
| 300 MB blob | `exec-out cat` pipe | ~9 MB/s |

The verdict is **hybrid, not one method**: small-file dirs get tarred on-device first (eliminates per-file sync-protocol round-trips — the real bottleneck), large files go over parallel plain pulls. `adb pull -z` never wins on incompressible data. `exec-out` pipes always lose to framing overhead.

Re-run the shootout yourself before "optimizing" anything: `./bin/speed-race.sh`. Full numbers in [docs/benchmarks.md](docs/benchmarks.md).

## How it works

```
phone (/sdcard)                    your server
┌──────────────┐                   ┌─────────────────────────┐
│ Download/    │── tar-pull ──────▶│ archives/               │
│ Documents/   │── parallel-pull ─▶│ docs/        (triaged   │
│ Export/      │── parallel-pull ─▶│ code/         by the    │
│ Tasker/ …    │                   │ repos/        classifier)│
│              │                   │ manifests/backup.db ◀── │ incremental state
└──────────────┘                   └─────────────────────────┘
        ▲ Syncthing (continuous) ──▶ incoming/ ──▶ classifier ─▶ triage
```

1. **Discover** — resolve the phone's wireless-ADB endpoint (port rotates).
2. **Stat** — per-dir file counts and sizes (batched on-device `stat`, not one shell per file).
3. **Select** — >100 files with <1 MB average → tar-on-device; otherwise parallel pull.
4. **Pull** — 8-way bounded concurrency, every file recorded in SQLite.
5. **Manifest** — timestamped text manifest + `backup.db`; `verify` checks the archive against it.
6. **Triage (optional)** — the event-driven classifier watches `incoming/` (Syncthing landing zone) and routes arrivals into `repos/` `archives/` `code/` `docs/`. Photos and credential-shaped content are **never** auto-routed — they wait in `incoming/` for you.

Photos (`DCIM/`, `Pictures/`) are out of scope by design. `clean` (delete from phone) refuses to run unless `verify` passes first, still needs `--yes`, and will never touch photo dirs.

## Quickstart

**Prereqs:** [Bun](https://bun.sh) ≥ 1.2, [Android platform-tools](https://developer.android.com/tools/releases/platform-tools) (`adb`), wireless debugging enabled and paired on your phone.

```bash
git clone https://github.com/toxicwind/slough.git && cd slough
bun install

# one-shot bootstrap (no bun needed, coarse 4-way parallel):
./bin/fast-pull.sh ~/phone-archive

# or the full tool (incremental SQLite manifests, hybrid method selection):
bun src/index.ts pull ~/phone-archive

# later — only changed files move:
bun src/index.ts pull ~/phone-archive

# trust but verify (required before any delete):
bun src/index.ts verify ~/phone-archive
```

Point it at your phone: `MOLT_PIXEL_IP` if your phone isn't at `10.0.0.77`, `MOLT_SOURCES` for a custom dir list, `MOLT_PARALLEL` for stream count. See [.env.example](.env.example).

## Configuration

| Env | Default | What |
|---|---|---|
| `MOLT_ADB` | `/usr/bin/adb` | adb binary |
| `MOLT_PIXEL_IP` | `10.0.0.77` | phone IP (port auto-discovered) |
| `MOLT_SOURCES` | `Download,Documents,Export,1openfang,Tasker,House` | `/sdcard` dirs to back up |
| `MOLT_PARALLEL` | `8` | parallel pull streams |
| `MOLT_DEST` | `/mnt/8TB/phone-archive` | archive root |

## Docs

- [docs/benchmarks.md](docs/benchmarks.md) — the full 8-method shootout, methodology, raw numbers
- [docs/toybox-quirk.md](docs/toybox-quirk.md) — why `find /sdcard` returns nothing (and the workaround)
- [docs/manifest.md](docs/manifest.md) — SQLite schema, incremental logic, verify flow
- [docs/syncthing.md](docs/syncthing.md) — the continuous-sync future: batch pulls are the bootstrap
- [docs/safety.md](docs/safety.md) — what slough will and won't touch on your phone
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [CHANGELOG.md](CHANGELOG.md) — release history

## Project layout

```
slough/
├── src/
│   ├── index.ts        # CLI: pull | verify | clean
│   ├── pull.ts         # hybrid transfer engine
│   ├── classifier.ts   # event-driven Syncthing arrival triage
│   ├── manifest.ts     # SQLite incremental manifest
│   ├── discover.ts     # wireless-ADB endpoint discovery
│   └── config.ts       # env-driven configuration
├── bin/
│   ├── fast-pull.sh    # zero-dependency bootstrap pull
│   └── speed-race.sh   # 8-method transfer shootout
├── tests/
│   └── classifier.test.ts
└── docs/
```

## Status

v1.0.0 — the tool as it runs in production against a real, very full Pixel. Batch pulls are the bootstrap; the steady state is Syncthing continuous sync with the classifier triaging on arrival (see [docs/syncthing.md](docs/syncthing.md)).

## License

MIT — see [LICENSE](LICENSE). Your phone, your files, your server.
