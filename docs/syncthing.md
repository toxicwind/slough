# Syncthing: the continuous future

Batch pulls are the bootstrap, not the steady state. The future-forward lane is **Syncthing phone → server continuous sync**: files land on the archive as they're created, event-driven, no batch jobs, no timers.

## Why Syncthing won the debate

| Option | Verdict |
|---|---|
| `syncthing/syncthing` (89k⭐, very alive) | **winner** — official Android app, event-driven, battle-tested |
| `rclone/rclone` (60k⭐, alive) | strong second — better for one-shot/cloud, not continuous |
| `google/adb-sync` (archived 2024) | dead upstream — incremental-sync *idea* only, do not fork |

## Target architecture

```
phone ──Syncthing──▶ server:/<archive>/incoming/ ──▶ slough classifier ──▶ triage
```

1. The official Syncthing Android app syncs chosen folders to `<archive>/incoming/` on the server.
2. `bun src/classifier.ts <archive>` watches `incoming/` with `fs.watch` (event-driven — never a timer), debounces 5s for Syncthing to finish writing, and routes each file:
   - `repos/` — git checkouts (`.git/` present)
   - `archives/` — zip/tar/gz/7z/apk/rar (extension **or** magic bytes — misnamed `*.tar.gz.pdf` files are caught)
   - `code/` — py/sh/js/ts/go/rs/lua
   - `docs/` — md/txt/pdf/html/json/csv (credential-screened)
3. **Photos and credential-shaped content are never auto-routed.** They stay in `incoming/` (photos) or move to `quarantine/` (credentials) for manual review. That's a safety rule, not a TODO.

## Status

The classifier is implemented and unit-tested (`bun test` — the routing decision is a pure function, no phone required). The Syncthing pairing itself is a manual one-time setup: install the app, pair with the server, point it at `incoming/`. `fast-pull.sh` / `bun src/index.ts pull` remain the one-shot and backfill tools.
