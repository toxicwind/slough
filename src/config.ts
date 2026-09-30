#!/usr/bin/env bun
/**
 * slough — configuration.
 *
 * Everything the tool needs to know about the phone and the archive.
 * Override via environment; see .env.example.
 */

export const ADB = process.env.MOLT_ADB ?? "/usr/bin/adb";

// Phone endpoint: the last octet is matched, the port is discovered live
// (wireless ADB rotates the port — see discover.ts).
export const PIXEL_IP = process.env.MOLT_PIXEL_IP ?? "10.0.0.77";

// Top-level /sdcard dirs to back up. Photos (DCIM/Pictures) are out of scope.
export const SOURCE_DIRS: string[] = (
  process.env.MOLT_SOURCES ?? "Download,Documents,Export,1openfang,Tasker,House"
).split(",").map((s) => s.trim()).filter(Boolean);

// Parallel pull streams. Validated by benchmark: 8-way is the sweet spot.
export const PARALLEL_STREAMS = Number(process.env.MOLT_PARALLEL ?? 8);

// Hybrid selection: dirs with more files than this AND average file size
// below the threshold go through on-device tar (kills per-file round-trips).
export const TAR_FILE_THRESHOLD = 100;
export const TAR_AVG_SIZE_THRESHOLD = 1024 * 1024; // 1 MB

// Batch size for batched on-device stat calls (incremental manifest).
export const STAT_BATCH = 200;

// Archive layout (created under the destination root).
export const ARCHIVE_SUBDIRS = [
  "repos",     // git checkouts (.git/ present)
  "archives",  // zip/tar/gz/7z/apk/rar
  "code",      // py/sh/js/ts/go/rs
  "docs",      // md/txt/pdf/html (credential-screened)
  "manifests", // pull manifests + backup.db, forever
  "incoming",  // Syncthing landing zone (classifier watches this)
] as const;
