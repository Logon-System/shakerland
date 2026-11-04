#!/usr/bin/env bash
# Runs one shaker CSL module/CRTC capture against one amspirit-lite-headless
# binary. Screenshots come from the shaker program's own SSM opcodes (--ssm),
# named "AMSPIRIT_<crtc>_<4-hex-digit code>.png" by the emulator — the same
# codes as shakerland/data/tests.json's "hex" field / shaker_code_to_test_id.csv,
# and the exact input scripts/rename_pictures_shaker_code/rename_shaker.sh
# expects. This script does NOT rename them — that's a separate, deliberate step.
#
# Part of the fork-vs-upstream pixel non-regression pipeline (see the plan in
# amspirit-core: "Non-régression pixel shaker"). Two builds of
# amspirit-lite-headless (one per core version) are each run against the same
# CSL script (only change: annotate-csl.js disables the trailing csl_load so
# it doesn't chain into the next CRTC), writing into a separate RUNS_DIR/<run>/
# subtree so shakerland's /compare page can diff them pixel-by-pixel.
#
# These captures are worth keeping (candidates for the PictureBank image bank
# once renamed to match the test codes — separate script, not this one) — so
# RUNS_DIR defaults straight into PictureBank, not a scratch/tmp directory.
# Pass <run-name> as "<archId>/<version>" (e.g. "amspirit/fork-3d52bad10e7d",
# "amspirit/upstream-core_orig") to land exactly on PictureBank's own
# <archId>/<version>/ convention (see shakerland/data/archs.json) — never a
# bare tmp-style name like "fork"/"upstream" again.
#
# Usage:
#   scripts/capture-run.sh <headless-binary> <module A-E> <crtc 0-4> <run-name> [RUNS_DIR]
#
# Env:
#   RUNS_DIR   external captures root (default: ../PictureBank next to this repo,
#              same convention/location as PICTURES_DIR in server.js)
#   ROMS       ROM directory passed to the binary (default: same as smoke-headless.sh's
#              convention — see amspirit-lite/scripts/smoke-headless.sh)
#   PORT       web server port (default: 8791, distinct from smoke-headless's 8790)
set -u

BIN="${1:?usage: capture-run.sh <binary> <module> <crtc> <run-name> [RUNS_DIR]}"
MODULE="${2:?module letter A-E}"
CRTC="${3:?crtc 0-4}"
RUN_NAME="${4:?run name, e.g. amspirit/fork-<hash> or amspirit/upstream-core_orig}"
RUNS_DIR="${5:-${RUNS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/PictureBank}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHAKER_DIR="$SCRIPT_DIR/../public/Shaker_CSL"
CAPTURE_CSL_DIR="$SCRIPT_DIR/../public/Shaker_CSL_capture"

PORT="${PORT:-8791}"
ROMS="${ROMS:-}"
BASE="http://127.0.0.1:$PORT"

fail() {
  echo "::error::capture-run: $1" >&2
  echo "--- last log lines ---" >&2
  tail -40 "$WORK/headless.log" 2>/dev/null >&2
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null
  exit 1
}

[ -x "$BIN" ] || fail "binary not found or not executable: $BIN"

SRC_CSL="$SHAKER_DIR/MODULE_$MODULE/SHAKE26${MODULE}-${CRTC}.CSL"
[ -f "$SRC_CSL" ] || fail "no such CSL script: $SRC_CSL"

CAP_DIR="$RUNS_DIR/$RUN_NAME/${MODULE}_CRTC${CRTC}"
mkdir -p "$CAP_DIR"

CAP_CSL="$CAPTURE_CSL_DIR/MODULE_$MODULE/SHAKE26${MODULE}-${CRTC}.CSL"
node "$SCRIPT_DIR/annotate-csl.js" --in "$SRC_CSL" --out "$CAP_CSL" \
  || fail "annotate-csl.js failed"

WORK="$(mktemp -d)"
ln -s "$SHAKER_DIR/shaker27.dsk" "$WORK/shaker27.dsk"

cd "$WORK" || fail "cannot cd into work dir"

# SSM screenshots (no CSL screenshot_dir configured) land directly in cwd —
# collected into CAP_DIR once the run finishes, see below.
ARGS=(--script "$CAP_CSL" --ssm --web-port "$PORT" --autoExit 100000000 -C "$WORK/cfg")
[ -n "$ROMS" ] && ARGS+=(-R "$ROMS")

"$BIN" "${ARGS[@]}" > "$WORK/headless.log" 2>&1 &
PID=$!

for i in $(seq 1 50); do
  curl -sf --max-time 2 "$BASE/api/ping" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || fail "process died during boot"
  sleep 0.2
done

# Poll until the CSL script reports it is no longer running. Shaker modules
# run long (dozens of seconds of emulated + real time at 50 Hz) — generous
# timeout, checked every 0.5 s so this doesn't busy-loop curl.
DONE=0
for i in $(seq 1 1200); do
  kill -0 "$PID" 2>/dev/null || fail "process died while running the script"
  ST=$(curl -sf --max-time 2 "$BASE/api/script" 2>/dev/null) || continue
  case "$ST" in
    *'"running": false'*|*'"running":false'*) DONE=1; break ;;
  esac
  sleep 0.5
done
[ "$DONE" = 1 ] || fail "script did not finish within timeout: $ST"

case "$ST" in
  *'"error": ""'*|*'"error":""'*) : ;;
  *) fail "script finished with an error: $ST" ;;
esac

curl -sf -X POST "$BASE/api/quit" >/dev/null || fail "POST /api/quit failed"
for i in $(seq 1 25); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done
kill -0 "$PID" 2>/dev/null && fail "process still alive after /api/quit"
wait "$PID"

shopt -s nullglob nocaseglob
SHOTS=("$WORK"/AMSPIRIT_*.png)
shopt -u nocaseglob
[ "${#SHOTS[@]}" -gt 0 ] || fail "no AMSPIRIT_*.png produced — was --ssm effective? check $WORK/headless.log"
mv "${SHOTS[@]}" "$CAP_DIR/"

COUNT=$(find "$CAP_DIR" -name '*.png' | wc -l)
echo "capture-run OK: $RUN_NAME / ${MODULE}_CRTC${CRTC} -> $COUNT PNG(s) in $CAP_DIR"
rm -rf "$WORK"
