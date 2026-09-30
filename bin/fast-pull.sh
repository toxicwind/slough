#!/usr/bin/env bash
# slough fast-pull — bootstrap parallel pull: phone code/archives/repos -> DEST.
# Zero-dependency one-shot (no bun needed). For incremental pulls + manifests,
# use `bun src/index.ts pull` instead.
#
# Usage: bin/fast-pull.sh [dest]            (default: /mnt/8TB/phone-archive)
#        PIXEL=10.0.0.77:PORT bin/fast-pull.sh   (skip auto-discovery)
set -euo pipefail

DEST="${1:-${MOLT_DEST:-/mnt/8TB/phone-archive}}"
mkdir -p "$DEST"

PIXEL="${PIXEL:-}"
if [[ -z "$PIXEL" ]]; then
  PIXEL="$(adb devices | awk '/^10\.0\.0\.77:[0-9]+[[:space:]]+device/{print $1; exit}')"
fi
[[ -n "$PIXEL" ]] || { echo "slough: no phone endpoint (is wireless debugging on?)" >&2; exit 1; }
export PIXEL DEST
echo "slough: phone=$PIXEL dest=$DEST"

MANIFEST="$DEST/manifests/pull-manifest-$(date -u +%Y%m%dT%H%M%SZ).txt"
mkdir -p "$DEST/manifests"
export MANIFEST
echo "# slough fast-pull manifest $(date -u +%FT%TZ) phone=$PIXEL dest=$DEST" > "$MANIFEST"

pull_one() {
  local src="$1"
  local size files
  if adb -s "$PIXEL" pull "/sdcard/$src" "$DEST/$src" >/tmp/slough-pull-"$src".log 2>&1; then
    size=$(du -sh "$DEST/$src" | cut -f1)
    files=$(find "$DEST/$src" | wc -l)
    echo "OK $src size=$size files=$files" | tee -a "$MANIFEST"
  else
    echo "FAIL $src" | tee -a "$MANIFEST"
    return 1
  fi
}
export -f pull_one

# 4-way parallel across top-level dirs (the bun puller uses 8-way per file;
# this script stays coarse and dependency-free).
# NOTE: the inner `bash -c` is a fresh shell — pull_one AND PIXEL/DEST/MANIFEST
# must be exported above, or you get silent 0-byte "success".
# shellcheck disable=SC2086 # intentional: split MOLT_SOURCES on spaces into dirs
printf '%s\n' ${MOLT_SOURCES:-Download Documents Export 1openfang Tasker House} | \
  xargs -P4 -I{} bash -c 'pull_one "$@"' _ {}

echo "slough: done. manifest: $MANIFEST"
