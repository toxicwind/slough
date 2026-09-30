# The toybox quirk

Android's `/sdcard` is served by a toybox-based FUSE layer, and it has a quirk that will bite every backup script eventually:

```bash
adb shell 'find /sdcard -type f'     # returns NOTHING
```

No error, no files — just empty output. The same `find` scoped to a subdirectory works fine:

```bash
adb shell 'find /sdcard/Download -type f'   # works
```

## The workaround

Never walk `/sdcard` itself. Iterate its top-level entries and walk each one:

```bash
for d in /sdcard/*/; do
  adb shell "find $d -type f ..."
done
```

slough does this everywhere: `src/pull.ts` stats and lists per source dir, never from the root. The same quirk affects `du` — per-dir `du -sb /sdcard/<dir>` works; bare `du -sb /sdcard` may not.

## Why it matters

A backup tool that trusts `find /sdcard` will report "0 files, backup complete" and you'll believe it until you don't. slough's `verify` command exists partly because of this: the manifest records what was *supposed* to be pulled, and verify checks it against what's actually on disk.
