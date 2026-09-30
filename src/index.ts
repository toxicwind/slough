#!/usr/bin/env bun
/**
 * slough — shed the weight off your Android phone.
 *
 *   bun src/index.ts pull [dest]     pull phone -> dest (incremental)
 *   bun src/index.ts pull --full     ignore the manifest, pull everything
 *   bun src/index.ts verify [dest]   check the archive against the manifest
 *   bun src/index.ts clean --yes     delete verified dirs from the phone
 *   bun src/classifier.ts [dest]     watch incoming/ and triage arrivals
 *
 * Photos (DCIM/Pictures) are never touched. `clean` refuses to run unless
 * `verify` passes first, and still needs --yes.
 */

import { mkdirSync } from "fs";
import { join } from "path";
import { ARCHIVE_SUBDIRS, SOURCE_DIRS } from "./config.ts";
import { discoverPixel, adbShell } from "./discover.ts";
import { ManifestDB } from "./manifest.ts";
import { pullDir, verifyDir, type TransferResult } from "./pull.ts";

function usage(): never {
  console.log(`slough — shed the weight off your Android phone

  pull [dest] [--full]   pull phone -> dest (incremental by default)
  verify [dest]          check archive against the manifest DB
  clean --yes [dest]     delete verified source dirs from the phone

env: MOLT_ADB MOLT_PIXEL_IP MOLT_SOURCES MOLT_PARALLEL MOLT_DEST`);
  process.exit(1);
}

async function cmdPull(dest: string, incremental: boolean) {
  for (const d of ARCHIVE_SUBDIRS) mkdirSync(join(dest, d), { recursive: true });
  const manifest = new ManifestDB(join(dest, "manifests", "backup.db"));
  const pixel = await discoverPixel();
  console.log(`phone: ${pixel}  dest: ${dest}  mode: ${incremental ? "incremental" : "full"}`);

  const results: TransferResult[] = [];
  for (const dir of SOURCE_DIRS) {
    results.push(await pullDir(pixel, dir, dest, manifest, incremental));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestTxt = join(dest, "manifests", `pull-manifest-${stamp}.txt`);
  const lines = results.map(
    (r) => `${r.method === "skipped" ? "SKIP" : "OK"} ${r.dir} files=${r.files} bytes=${r.bytes} method=${r.method} ms=${r.durationMs}`
  );
  await Bun.write(manifestTxt, `# slough manifest ${new Date().toISOString()} phone=${pixel}\n${lines.join("\n")}\n`);
  const totalFiles = results.reduce((a, r) => a + r.files, 0);
  const totalBytes = results.reduce((a, r) => a + r.bytes, 0);
  console.log(`\ndone: ${totalFiles} files, ${(totalBytes / 1073741824).toFixed(2)} GB — manifest: ${manifestTxt}`);
  manifest.close();
}

async function cmdVerify(dest: string): Promise<boolean> {
  const manifest = new ManifestDB(join(dest, "manifests", "backup.db"));
  let ok = true;
  for (const dir of SOURCE_DIRS) {
    const { missing, sizeMismatch } = verifyDir(dest, dir, manifest);
    if (missing.length === 0 && sizeMismatch.length === 0) {
      console.log(`OK ${dir}`);
    } else {
      ok = false;
      console.log(`FAIL ${dir}: ${missing.length} missing, ${sizeMismatch.length} size-mismatch`);
      for (const m of [...missing, ...sizeMismatch].slice(0, 10)) console.log(`  - ${m}`);
    }
  }
  manifest.close();
  console.log(ok ? "\nverify: clean" : "\nverify: PROBLEMS — do not clean the phone");
  return ok;
}

async function cmdClean(dest: string, confirmed: boolean) {
  if (!confirmed) {
    console.error("refusing: pass --yes to delete anything from the phone");
    process.exit(2);
  }
  console.log("verifying before any delete...");
  if (!(await cmdVerify(dest))) process.exit(3);

  const pixel = await discoverPixel();
  for (const dir of SOURCE_DIRS) {
    // Belt and suspenders: never delete photo dirs, even if configured.
    if (/^(DCIM|Pictures)$/i.test(dir)) {
      console.log(`skip ${dir} (photo dir — never deleted)`);
      continue;
    }
    console.log(`deleting /sdcard/${dir} from phone...`);
    await adbShell(pixel, `rm -rf /sdcard/${dir}`);
  }
  console.log("clean done. The archive is now the only copy — keep it safe.");
}

async function main() {
  const [cmd, ...rest] = Bun.argv.slice(2);
  const dest = rest.find((a) => !a.startsWith("-")) ?? process.env.MOLT_DEST ?? "/mnt/8TB/phone-archive";

  if (cmd === "pull" || cmd === undefined) {
    await cmdPull(dest, !rest.includes("--full"));
  } else if (cmd === "verify") {
    const ok = await cmdVerify(dest);
    process.exit(ok ? 0 : 1);
  } else if (cmd === "clean") {
    await cmdClean(dest, rest.includes("--yes"));
  } else {
    usage();
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
