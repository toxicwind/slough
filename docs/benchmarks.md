# Benchmarks

The transfer path was chosen by measurement, not intuition. `bin/speed-race.sh` runs the full 8-method shootout; this page records the methodology and the results that shaped slough's hybrid strategy.

## Methodology

- **Device:** Pixel 9 Pro XL, wireless ADB, same room as the server.
- **Small-file payload:** 1000 × 100KB files (131 MB total) — the per-file sync-protocol round-trip torture test.
- **Large-file payload:** 1 × 300MB incompressible blob (`/dev/urandom`) — the sequential-throughput ceiling.
- Each method runs against a fresh destination dir; wall-clock measured with nanosecond timestamps; throughput = bytes / wall-clock.
- Payloads are built idempotently on the phone and cleaned up afterwards.

## Results (2026-09-30)

### Small files (1000 × 100KB = 131 MB)

| Method | Time | Throughput |
|---|---|---|
| on-device `tar` + single pull | 4.5s | **~29 MB/s** ← winner |
| 8-way parallel `adb pull` | 6.4s | ~20 MB/s |
| plain `adb pull` | 15.9s | ~8 MB/s |
| `adb pull -z` (compressed) | 14.8s | ~9 MB/s |

### Large file (300 MB incompressible blob)

| Method | Time | Throughput |
|---|---|---|
| plain `adb pull` | 6.8s | **~44 MB/s** ← winner |
| on-device `tar` + single pull | 8.0s | ~38 MB/s |
| `adb pull -z` (compressed) | 7.6s | ~40 MB/s |
| `exec-out cat` pipe | 35.0s | ~9 MB/s |

## Reading the results

- **Per-file round-trips are the bottleneck for small files**, not bandwidth. Tarring on-device collapses 1000 round-trips into one stream — 3.5× faster than plain pull.
- **For large files, plain pull wins.** Tar adds on-device CPU + a second pass; compression (`-z`) can't compress random data and only adds CPU.
- **`exec-out` pipes are a trap.** They look clever (skip the sync protocol!) but framing overhead caps them at ~9 MB/s. An earlier tar-*streaming*-via-exec-out test showed the same: 7 MB/s vs 30 MB/s for on-device tar + separate pull. The pipe is the problem, not the tar.
- **`adb pull -z` never wins** on incompressible data (which is what phones mostly hold: zips, apks, media).

## The hybrid rule (what slough implements)

Per directory, from live stats before pulling:

- `files > 100` **and** `avg_size < 1 MB` → **tar-pull** (on-device tar, pull one tarball, extract, clean up both ends)
- otherwise → **parallel-pull** (8-way bounded `adb pull` per file)

## Reproduce

```bash
./bin/speed-race.sh /tmp/slough-speed-race
```

It prints a `RESULTS.txt` and cleans the bench payloads off the phone. If your numbers disagree with the table above on your hardware, open an issue — the hybrid thresholds (`TAR_FILE_THRESHOLD`, `TAR_AVG_SIZE_THRESHOLD` in `src/config.ts`) are env-tunable for exactly this reason.
