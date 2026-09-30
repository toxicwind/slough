#!/usr/bin/env bun
/**
 * slough — arrival classifier.
 *
 * Event-driven (fs.watch, never timers): watches the Syncthing landing zone
 * and routes each settled file into the archive layout:
 *
 *   repos/    <- git checkouts (.git/ present)
 *   archives/ <- zip/tar/gz/7z/apk/rar (+ MIME fallback when the extension is unknown)
 *   code/     <- py/sh/js/ts/go/rs
 *   docs/     <- md/txt/pdf/html/json (credential-screened)
 *
 * Photos and credential-shaped content are NEVER auto-routed — they stay in
 * incoming/ for manual review. That's a safety rule, not a TODO.
 *
 * The routing decision is a pure function (routeFor) so it's unit-testable
 * without a phone, a filesystem, or Syncthing. See tests/classifier.test.ts.
 */

import { watch } from "fs";
import { join, basename, extname, dirname } from "path";
import { existsSync, mkdirSync, renameSync, statSync, readFileSync } from "fs";
import { $ } from "bun";
import { ARCHIVE_SUBDIRS } from "./config.ts";

// ---------------------------------------------------------------------------
// Pure routing decision — no I/O except the content head passed in.
// ---------------------------------------------------------------------------

export type Route = "repos" | "archives" | "code" | "docs" | "quarantine" | "manual";

const EXT_ROUTES: Record<string, Exclude<Route, "quarantine" | "manual">> = {
  ".zip": "archives", ".tar": "archives", ".gz": "archives", ".tgz": "archives",
  ".7z": "archives", ".rar": "archives", ".apk": "archives",
  ".py": "code", ".sh": "code", ".js": "code", ".ts": "code",
  ".go": "code", ".rs": "code", ".lua": "code",
  ".md": "docs", ".txt": "docs", ".pdf": "docs", ".html": "docs",
  ".json": "docs", ".csv": "docs", ".org": "docs",
};

const PHOTO_PATTERNS = [
  /dcim/i, /pictures/i, /screenshots?/i,
  /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i,
  /\.(mp4|mkv|avi|mov|3gp|webm)$/i,
];

const CREDENTIAL_PATTERNS = [
  /api[_-]?key/i, /password/i, /secret/i, /passwd/i,
  /BEGIN.*PRIVATE KEY/i, /aws_secret/i, /ghp_[A-Za-z0-9]{20,}/,
];

export function isPhotoPath(name: string): boolean {
  return PHOTO_PATTERNS.some((p) => p.test(name));
}

export function looksLikeCredentials(head: string): boolean {
  return CREDENTIAL_PATTERNS.some((p) => p.test(head));
}

/**
 * Decide where a file goes. Inputs are pre-gathered so tests can call this
 * with fixtures and no filesystem.
 */
export function routeFor(opts: {
  name: string;
  ext: string;
  mime: string;          // e.g. "application/zip", "" when unknown
  isGitRepo: boolean;
  contentHead: string;   // first ~10KB as text, "" for binary/unreadable
}): Route {
  if (isPhotoPath(opts.name)) return "manual";

  if (opts.isGitRepo) return "repos";

  const extRoute = EXT_ROUTES[opts.ext.toLowerCase()];
  if (extRoute) {
    if (extRoute === "docs" && looksLikeCredentials(opts.contentHead)) return "quarantine";
    return extRoute;
  }

  // MIME fallback for extensionless files or unknown extensions.
  // Known extensions always win (a real .pdf is docs, even if misnamed).
  const mime = opts.mime.toLowerCase();
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip") || mime.includes("7z")) {
    return "archives";
  }
  if (mime === "text/x-python" || mime === "text/x-shellscript") return "code";
  if (mime.startsWith("text/")) {
    return looksLikeCredentials(opts.contentHead) ? "quarantine" : "docs";
  }
  return "manual";
}

// ---------------------------------------------------------------------------
// Filesystem driver — gathers inputs, calls routeFor, moves the file.
// ---------------------------------------------------------------------------

async function getMimeType(path: string): Promise<string> {
  try {
    return (await $`file -b --mime-type ${path}`.text()).trim();
  } catch {
    return "";
  }
}

function contentHead(path: string): string {
  try {
    const buf = readFileSync(path);
    // Bail on binary: a NUL byte in the first 1KB means "not text".
    if (buf.subarray(0, 1024).includes(0)) return "";
    return buf.subarray(0, 10240).toString("utf-8");
  } catch {
    return "";
  }
}

function isGitRepo(path: string): boolean {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, ".git"));
  } catch {
    return false;
  }
}

function uniqueDest(archive: string, route: string, name: string): string {
  const ext = extname(name);
  let dest = join(archive, route, name);
  let i = 1;
  while (existsSync(dest)) {
    dest = join(archive, route, `${basename(name, ext)}-${i}${ext}`);
    i++;
  }
  return dest;
}

export async function classifyAndRoute(
  archive: string,
  filePath: string,
): Promise<Route> {
  const name = basename(filePath);
  if (name.startsWith(".") || name.endsWith("~") || name.endsWith(".tmp")) {
    return "manual"; // hidden/temp: leave alone
  }

  const route = routeFor({
    name,
    ext: extname(name),
    mime: await getMimeType(filePath),
    isGitRepo: isGitRepo(filePath),
    contentHead: contentHead(filePath),
  });

  if (route === "manual") {
    console.log(`MANUAL-REVIEW: ${name} (left in incoming/)`);
    return route;
  }
  if (route === "quarantine") {
    const q = join(archive, "quarantine");
    mkdirSync(q, { recursive: true });
    renameSync(filePath, uniqueDest(archive, "quarantine", name));
    console.log(`QUARANTINE: ${name} (credential-shaped content)`);
    return route;
  }

  const dest = uniqueDest(archive, route, name);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(filePath, dest);
  console.log(`ROUTED ${route}/: ${name}`);
  return route;
}

// ---------------------------------------------------------------------------
// Watcher — event-driven, never timers.
// ---------------------------------------------------------------------------

export function watchIncoming(archive: string): void {
  const incoming = join(archive, "incoming");
  mkdirSync(incoming, { recursive: true });
  for (const d of ARCHIVE_SUBDIRS) mkdirSync(join(archive, d), { recursive: true });

  console.log(`slough classifier watching ${incoming} ...`);

  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(incoming, { recursive: true }, (_event, filename) => {
    if (!filename || typeof filename !== "string") return;
    const full = join(incoming, filename);
    const prev = pending.get(full);
    if (prev) clearTimeout(prev);
    // Debounce: wait for Syncthing to finish writing before classifying.
    pending.set(
      full,
      setTimeout(async () => {
        pending.delete(full);
        if (!existsSync(full)) return;
        try {
          await classifyAndRoute(archive, full);
        } catch (e) {
          console.error(`classify failed for ${filename}:`, e);
        }
      }, 5000),
    );
  });

  const shutdown = () => {
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// CLI: bun src/classifier.ts [archive-root]
const archiveArg = Bun.argv[2] ?? process.env.MOLT_DEST ?? "/mnt/8TB/phone-archive";
if (import.meta.main) watchIncoming(archiveArg);
