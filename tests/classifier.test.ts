/**
 * slough — classifier routing tests.
 *
 * The routing decision is pure (routeFor), so these run with no phone,
 * no filesystem, no Syncthing. Run: bun test
 */
import { describe, expect, test } from "bun:test";
import { routeFor, isPhotoPath, looksLikeCredentials } from "../src/classifier.ts";

const base = {
  name: "notes.txt",
  ext: ".txt",
  mime: "text/plain",
  isGitRepo: false,
  contentHead: "just some notes",
};

describe("routeFor", () => {
  test("code extensions route to code/", () => {
    for (const ext of [".py", ".sh", ".js", ".ts", ".go", ".rs"]) {
      expect(routeFor({ ...base, name: `x${ext}`, ext }).valueOf()).toBe("code");
    }
  });

  test("archive extensions route to archives/", () => {
    for (const ext of [".zip", ".tar", ".gz", ".7z", ".apk", ".rar"]) {
      expect(routeFor({ ...base, name: `x${ext}`, ext })).toBe("archives");
    }
  });

  test("docs route to docs/", () => {
    expect(routeFor({ ...base })).toBe("docs");
    expect(routeFor({ ...base, name: "deck.pdf", ext: ".pdf" })).toBe("docs");
  });

  test("git checkouts route to repos/ regardless of extension", () => {
    expect(routeFor({ ...base, name: "weird-dir", ext: "", isGitRepo: true })).toBe("repos");
  });

  test("photos are never auto-routed", () => {
    for (const n of ["DCIM_001.jpg", "Pictures/vacation.png", "screenshot_2026.webp", "clip.mp4"]) {
      expect(routeFor({ ...base, name: n, ext: ".jpg" })).toBe("manual");
    }
  });

  test("credential-shaped docs go to quarantine, not docs/", () => {
    expect(
      routeFor({ ...base, contentHead: "export API_KEY=sk-live-12345" })
    ).toBe("quarantine");
    expect(
      routeFor({ ...base, contentHead: "-----BEGIN RSA PRIVATE KEY-----" })
    ).toBe("quarantine");
  });

  test("misnamed archives detected by MIME when the extension is unknown", () => {
    expect(
      routeFor({ ...base, name: "backup.dat", ext: ".dat", mime: "application/gzip", contentHead: "" })
    ).toBe("archives");
  });

  test("known extensions win over MIME (a real .pdf is docs)", () => {
    expect(
      routeFor({ ...base, name: "backup.tar.gz.pdf", ext: ".pdf", mime: "application/gzip", contentHead: "" })
    ).toBe("docs");
  });

  test("extensionless text falls back to docs/ via MIME", () => {
    expect(routeFor({ ...base, name: "README", ext: "", mime: "text/plain" })).toBe("docs");
  });

  test("unknown binary is left for manual review", () => {
    expect(routeFor({ ...base, name: "blob", ext: "", mime: "application/octet-stream", contentHead: "" })).toBe("manual");
  });
});

describe("isPhotoPath", () => {
  test("matches photo/video paths and names", () => {
    expect(isPhotoPath("/sdcard/DCIM/IMG_001.jpg")).toBe(true);
    expect(isPhotoPath("pictures/heic0001.heic")).toBe(true);
  });
  test("does not match documents", () => {
    expect(isPhotoPath("report.pdf")).toBe(false);
  });
});

describe("looksLikeCredentials", () => {
  test("flags keys, passwords, tokens", () => {
    expect(looksLikeCredentials("password=hunter2")).toBe(true);
    expect(looksLikeCredentials("ghp_abcdefghijklmnopqrstuv")).toBe(true);
  });
  test("ignores prose", () => {
    expect(looksLikeCredentials("the api design is clean")).toBe(false);
  });
});
