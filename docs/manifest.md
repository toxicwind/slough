# Manifest

slough's incremental logic lives in a SQLite database at `<dest>/manifests/backup.db` (plus a human-readable timestamped text manifest per run, kept forever).

## Schema

```sql
files(path PK, size, mtime, hash, pulled_at)
pulls(id, started_at, completed_at, source_dir, files, bytes, status)
```

## Incremental pulls

On every `pull`, slough stats each remote file (batched on-device `stat`, `STAT_BATCH` files per shell call — not one shell per file) and consults the manifest:

- file never seen → pull it
- `size` or `mtime` changed → pull it
- otherwise → skip it

The second run against an unchanged phone pulls nothing. `--full` ignores the manifest.

## Verify

`bun src/index.ts verify <dest>` walks every row in `files` and checks the local copy exists with a matching size. Any missing or size-mismatched file is reported. `clean` refuses to run unless verify passes — the manifest is the chain of custody between "pulled" and "safe to delete from the phone".

## Text manifests

Each run also writes `manifests/pull-manifest-<UTC-timestamp>.txt`:

```
# slough manifest 2026-09-30T12:00:00.000Z phone=10.0.0.77:41234
OK Download files=14925 bytes=26843545600 method=tar-pull ms=912000
OK Documents files=312 bytes=271790080 method=parallel-pull ms=41000
```

These are append-only history. Never delete from the phone until the manifest is verified — spot-check sizes and open a few archives.
