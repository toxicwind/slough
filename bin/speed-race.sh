#!/usr/bin/env bash
# slough speed-race — hyper-race Android bulk-transfer methods, keep the winner.
# shellcheck disable=SC2016 # $() and $0 expand on the phone / inner bash, not locally
# 8 methods: plain/parallel/tar/compressed/pipe x small-files/big-blob.
# Re-run this before "optimizing" the transfer path. It will humble you.
#
# Usage: bin/speed-race.sh [results-dir]   (default: /tmp/slough-speed-race)
#        PIXEL=10.0.0.77:PORT bin/speed-race.sh
set -euo pipefail

RESULTS="${1:-/tmp/slough-speed-race}"
mkdir -p "$RESULTS"

PIXEL="${PIXEL:-}"
if [[ -z "$PIXEL" ]]; then
  PIXEL="$(adb devices | awk '/^10\.0\.0\.77:[0-9]+[[:space:]]+device/{print $1; exit}')"
fi
[[ -n "$PIXEL" ]] || { echo "slough: no phone endpoint" >&2; exit 1; }
export PIXEL
echo "slough: phone=$PIXEL results=$RESULTS"

A() { adb -s "$PIXEL" "$@"; }
export -f A

# ---- build test payloads (idempotent) ----
echo "== building payloads =="
A shell 'mkdir -p /sdcard/slough-bench-small /sdcard/slough-bench-big' >/dev/null
# 1000 x 100KB files (small-file torture: per-file round-trip hell)
A shell 'ls /sdcard/slough-bench-small | wc -l' | grep -q '^1000$' || \
  A shell 'for i in $(seq 1 1000); do head -c 102400 /dev/urandom | base64 > /sdcard/slough-bench-small/f$(printf %04d $i).txt; done'
# 1 x 300MB incompressible blob (sequential throughput ceiling)
A shell 'ls -l /sdcard/slough-bench-big/blob.bin 2>/dev/null | grep -q " 314572800 " || echo MISSING' | grep -q MISSING && \
  A shell 'head -c 314572800 /dev/urandom > /sdcard/slough-bench-big/blob.bin'
echo "payloads ready"

run() { # name, command...
  local name="$1"; shift
  local dest="$RESULTS/$name"; rm -rf "$dest"; mkdir -p "$dest"
  echo "== race: $name =="
  local t0 t1 dt
  t0=$(date +%s.%N)
  "$@" "$dest"
  t1=$(date +%s.%N)
  dt=$(echo "$t1 - $t0" | bc)
  local bytes; bytes=$(du -sb "$dest" | cut -f1)
  local mbps; mbps=$(echo "scale=1; $bytes / $dt / 1048576" | bc)
  printf '%-28s %8.1fs %8s MB %6s MB/s\n' "$name" "$dt" "$((bytes/1048576))" "$mbps" | tee -a "$RESULTS/RESULTS.txt"
}

: > "$RESULTS/RESULTS.txt"
echo "== $(date -u +%FT%TZ) phone=$PIXEL ==" | tee -a "$RESULTS/RESULTS.txt"

run pull-1way-small  bash -c 'A pull /sdcard/slough-bench-small "$0" >/dev/null 2>&1'
run pull-8way-small bash -c '
  dest="$0"
  A shell "ls /sdcard/slough-bench-small" | tr -d "\r" | \
    xargs -P8 -n125 -I{} sh -c "adb -s \"$PIXEL\" pull /sdcard/slough-bench-small/{} \"$dest/{}\" >/dev/null 2>&1"'
run tardev-pull-small bash -c '
  dest="$0"
  A shell "tar -cf /sdcard/slough-bench-small.tar -C /sdcard slough-bench-small" >/dev/null 2>&1
  A pull /sdcard/slough-bench-small.tar "$dest/small.tar" >/dev/null 2>&1
  A shell "rm /sdcard/slough-bench-small.tar" >/dev/null 2>&1'
run pull-1way-big   bash -c 'A pull /sdcard/slough-bench-big "$0" >/dev/null 2>&1'
run tardev-pull-big  bash -c '
  dest="$0"
  A shell "tar -cf /sdcard/slough-bench-big.tar -C /sdcard slough-bench-big" >/dev/null 2>&1
  A pull /sdcard/slough-bench-big.tar "$dest/big.tar" >/dev/null 2>&1
  A shell "rm /sdcard/slough-bench-big.tar" >/dev/null 2>&1'
run pull-z-big      bash -c 'A pull -z any /sdcard/slough-bench-big "$0" >/dev/null 2>&1'
run pull-z-small    bash -c 'A pull -z any /sdcard/slough-bench-small "$0" >/dev/null 2>&1'
run catpipe-big     bash -c 'A exec-out "cat /sdcard/slough-bench-big/blob.bin" > "$0/blob.bin" 2>/dev/null'

echo; echo "===== RESULTS ====="; cat "$RESULTS/RESULTS.txt"
echo; echo "cleaning bench payloads from phone..."
A shell 'rm -rf /sdcard/slough-bench-small /sdcard/slough-bench-big' >/dev/null 2>&1 || true
