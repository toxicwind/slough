#!/usr/bin/env bun
/**
 * molt — transfer engine.
 *
 * Hybrid strategy, picked per directory from live stats (benchmarked):
 *   many small files -> on-device tar, then pull one tarball  (~29 MB/s)
 *   large files      -> N-way parallel plain `adb pull`        (~44 MB/s)
 *
 * `adb pull -z` never wins on incompressible data; `exec-out` pipes always
 * lose to framing overhead. Don't "optimize" this without re-running
 * bin/speed-race.sh first.
 */

import { $ } from "bun";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { ADB, PARALLEL_STREAMS, STAT_BATCH, TAR_FILE_THRESHOLD, TAR_AVG_SIZE_THRESHOLD } from "./config.ts";
import { adbShell } from "./discover.ts";
import { ManifestDB } from "./manifest.ts";

export interface TransferResult {
  dir: string;
  files: number;
  bytes: number;
  method: "parallel-pull" | "tar-pull" | "skipped";
  durationMs: number;
}

export interface RemoteFile {
  path: string; // /sdcard/<dir>/...
  size: number;
  mtime: number;
}

// Toybox quirk: `find /sdcard` returns nothing — always scope to a subdir.
async function dirStats(pixel: string, dir: string): Promise<{ files: number; bytes: number }> {
  const files = parseInt((await adbShell(pixel, `find /sdcard/${dir} -type f 2>/dev/null | wc -l`)).trim()) || 0;
  const bytes = parseInt((await adbShell(pixel, `du -sb /sdcard/${dir} 2>/dev/null | cut -f1`)).trim()) || 0;
  return { files, bytes };
}

async function dirExists(pixel: string, dir: string): Promise<boolean> {
  const out = await adbShell(pixel, `ls -ld /sdcard/${dir} 2>&1 | head -1`);
  return !out.includes("No such file");
}

/**
 * One batched stat per STAT_BATCH files instead of one adb shell per file.
 * Returns size+mtime keyed by remote path.
 */
async function batchedStats(pixel: string, remotePaths: string[]): Promise<Map<string, { size: number; mtime: number }>> {
  const out = new Map<string, { size: number; mtime: number }>();
  for (let i = 0; i < remotePaths.length; i += STAT_BATCH) {
    const batch = remotePaths.slice(i, i + STAT_BATCH);
    // Quote each path; toybox stat -c works on multiple files.
    const args = batch.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(" ");
    const raw = await adbShell(pixel, `stat -c '%n|%s|%Y' ${args} 2>/dev/null`);
    for (const line of raw.split("\n")) {
      const [p, s, m] = line.trim().split("|");
      if (p && s !== undefined) out.set(p, { size: Number(s) || 0, mtime: Number(m) || 0 });
    }
  }
  return out;
}

async function parallelPull(
  pixel: string, dir: string, dest: string, manifest: ManifestDB, incremental: boolean,
): Promise<TransferResult> {
  const start = Date.now();
  const destDir = join(dest, dir);
  mkdirSync(destDir, { recursive: true });

  const listRaw = await adbShell(pixel, `find /sdcard/${dir} -type f 2>/dev/null`);
  const remotePaths = listRaw.split("\n").map((f) => f.trim().replace(/\r$/, "")).filter(Boolean);

  // Incremental: stat everything in batches, skip unchanged.
  let todo = remotePaths;
  let statMap = new Map<string, { size: number; mtime: number }>();
  if (incremental) {
    statMap = await batchedStats(pixel, remotePaths);
    todo = remotePaths.filter((p) => {
      const st = statMap.get(p);
      const rel = `${dir}/${p.replace(`/sdcard/${dir}/`, "")}`;
      return !st || manifest.needsPull(rel, st.size, st.mtime);
    });
  }

  const pullId = manifest.startPull(dir);
  let completed = 0;
  let totalBytes = 0;
  const queue = [...todo];

  const pullOne = async (remotePath: string) => {
    const rel = remotePath.replace(`/sdcard/${dir}/`, "");
    const localPath = join(destDir, rel);
    mkdirSync(join(localPath, ".."), { recursive: true });
    try {
      await $`${ADB} -s ${pixel} pull ${remotePath} ${localPath}`.quiet();
      const st = statMap.get(remotePath);
      const size = st?.size ?? 0;
      const mtime = st?.mtime ?? 0;
      totalBytes += size;
      completed++;
      manifest.recordFile(`${dir}/${rel}`, size, mtime);
    } catch (e) {
      console.error(`  pull failed: ${rel} (${e})`);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < PARALLEL_STREAMS; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const f = queue.shift();
        if (f) await pullOne(f);
      }
    })());
  }
  await Promise.all(workers);
  manifest.finishPull(pullId, completed, totalBytes);

  return { dir, files: completed, bytes: totalBytes, method: "parallel-pull", durationMs: Date.now() - start };
}

async function tarPull(
  pixel: string, dir: string, dest: string, manifest: ManifestDB,
): Promise<TransferResult> {
  const start = Date.now();
  const stats = await dirStats(pixel, dir);

  const tarName = `molt-${dir}-${Date.now()}.tar`;
  await adbShell(pixel, `cd /sdcard && tar -cf /sdcard/${tarName} ${dir} 2>/dev/null`);
  const destTar = join(dest, tarName);
  await $`${ADB} -s ${pixel} pull /sdcard/${tarName} ${destTar}`.quiet();

  const destDir = join(dest, dir);
  mkdirSync(destDir, { recursive: true });
  await $`tar -xf ${destTar} -C ${dest} --strip-components=1`.quiet();

  await adbShell(pixel, `rm -f /sdcard/${tarName}`);
  await $`rm -f ${destTar}`.quiet();

  const pullId = manifest.startPull(dir);
  manifest.finishPull(pullId, stats.files, stats.bytes);

  return { dir, files: stats.files, bytes: stats.bytes, method: "tar-pull", durationMs: Date.now() - start };
}

export async function pullDir(
  pixel: string, dir: string, dest: string, manifest: ManifestDB, incremental: boolean,
): Promise<TransferResult> {
  if (!(await dirExists(pixel, dir))) {
    console.log(`skip ${dir} (not on phone)`);
    return { dir, files: 0, bytes: 0, method: "skipped", durationMs: 0 };
  }
  const stats = await dirStats(pixel, dir);
  console.log(`${dir}: ${stats.files} files, ${(stats.bytes / 1048576).toFixed(1)} MB`);

  const avg = stats.files > 0 ? stats.bytes / stats.files : 0;
  const useTar = stats.files > TAR_FILE_THRESHOLD && avg < TAR_AVG_SIZE_THRESHOLD;

  const result = useTar
    ? await tarPull(pixel, dir, dest, manifest)
    : await parallelPull(pixel, dir, dest, manifest, incremental);

  const mbps = result.durationMs > 0 ? result.bytes / 1048576 / (result.durationMs / 1000) : 0;
  console.log(`  ok ${result.method}: ${result.files} files in ${(result.durationMs / 1000).toFixed(1)}s (${mbps.toFixed(1)} MB/s)`);
  return result;
}

/** Verify the local archive against the manifest DB. Returns mismatches. */
export function verifyDir(dest: string, dir: string, manifest: ManifestDB): { missing: string[]; sizeMismatch: string[] } {
  const missing: string[] = [];
  const sizeMismatch: string[] = [];
  for (const f of manifest.filesForDir(dir)) {
    const local = join(dest, f.path);
    if (!existsSync(local)) {
      missing.push(f.path);
      continue;
    }
    try {
      const actual = Bun.file(local).size;
      if (actual !== f.size) sizeMismatch.push(`${f.path} (manifest ${f.size}, disk ${actual})`);
    } catch {
      missing.push(f.path);
    }
  }
  return { missing, sizeMismatch };
}
