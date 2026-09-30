#!/usr/bin/env bun
/**
 * molt — endpoint discovery.
 *
 * Wireless ADB rotates the port, so the live endpoint is resolved on every
 * run instead of cached. Throws when the phone isn't reachable.
 */

import { $ } from "bun";
import { ADB, PIXEL_IP } from "./config.ts";

export async function discoverPixel(): Promise<string> {
  const out = await $`${ADB} devices`.text();
  const escaped = PIXEL_IP.replace(/\./g, "\\.");
  for (const line of out.split("\n")) {
    const m = line.match(new RegExp(`^${escaped}:(\\d+)\\s+device`));
    if (m) return `${PIXEL_IP}:${m[1]}`;
  }
  throw new Error(
    `phone not found at ${PIXEL_IP} — is wireless debugging on and paired? ` +
    `Check \`adb devices\` and re-pair if needed.`
  );
}

export async function adbShell(pixel: string, cmd: string): Promise<string> {
  return await $`${ADB} -s ${pixel} shell ${cmd}`.text();
}
