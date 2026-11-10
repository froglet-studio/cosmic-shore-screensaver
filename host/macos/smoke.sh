#!/usr/bin/env bash
# Smoke test for CosmicShore.saver on a real Mac desktop (CI runs it on macos-latest).
#   host/macos/smoke.sh dist-macos/CosmicShore.saver
# Checks: the bundle is signed and loads as a ScreenSaverView; the Options sheet builds; full screen and
# preview each draw the scene (a snapshot that is not black); the page asks for nothing outside itself and
# reports no error; com.apple.screensaver.willstop ends the full-screen process with exit 0 and leaves the
# preview running. Pictures go to smoke-macos/.
set -uo pipefail
saver="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$root/smoke-macos"
rm -rf "$out"
mkdir -p "$out" "$root/build"
failures=0
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }

codesign --verify --strict --verbose=2 "$saver" || fail "the bundle's signature does not verify"
lipo -archs "$saver/Contents/MacOS/CosmicShore"

harness="$root/build/harness"
xcrun swiftc -O -swift-version 5 -framework ScreenSaver -framework WebKit -framework AppKit \
  -o "$harness" "$here/smoke/Harness.swift" || { echo "FAIL: the harness did not build"; exit 1; }

"$harness" sheet "$saver" || fail "the Options sheet did not build"

# run <mode> <name>: starts the harness, waits for its snapshot; leaves $pid running
run() {
  local mode="$1" name="$2"
  export COSMICSHORE_SAVER_LOG="$out/$name.log"
  rm -f "$COSMICSHORE_SAVER_LOG"
  "$harness" run "$saver" "$mode" "$out/$name.png" > "$out/$name.out" 2>&1 &
  pid=$!
  for _ in $(seq 1 360); do
    grep -q "^lit=\|snapshot failed" "$out/$name.out" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  cat "$out/$name.out"
  screencapture -x "$out/$name-screen.png" 2>/dev/null || echo "(screencapture not available)"
  local lit
  lit="$(sed -n 's/^lit=//p' "$out/$name.out")"
  if [[ -z "$lit" ]]; then fail "$name: no snapshot (the scene never said ready)"
  elif python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) > 0.02 else 1)" "$lit"; then echo "$name: lit $lit"
  else fail "$name: the snapshot is black (lit $lit)"; fi
  grep -q "scene ready" "$COSMICSHORE_SAVER_LOG" || fail "$name: the page never said ready"
  if grep -E "refused|page error|load failed|navigation failed" "$COSMICSHORE_SAVER_LOG"; then fail "$name: the log shows a refused request or a page error"; fi
}

# ── full screen: draws, and willstop ends it with exit 0 ─────────────────────────────────────────
run s fullscreen
"$harness" willstop
code=""
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then wait "$pid"; code=$?; break; fi
  sleep 0.25
done
if [[ -z "$code" ]]; then fail "fullscreen: still running 10 s after willstop"; kill -9 "$pid" 2>/dev/null
elif [[ "$code" != 0 ]]; then fail "fullscreen: exited with $code after willstop"
else echo "fullscreen: willstop -> exit 0"; fi
cat "$out/fullscreen.log"

# ── preview: draws, and willstop leaves it running (System Settings keeps its thumbnail) ─────────
run p preview
"$harness" willstop
sleep 2
if kill -0 "$pid" 2>/dev/null; then echo "preview: still running after willstop (right)"; kill "$pid"; wait "$pid" 2>/dev/null
else fail "preview: willstop ended the preview process"; fi
cat "$out/preview.log"

# diagnostic only (never fails): does screencapture on this machine see a WebGL canvas at all?
"$harness" webgltest & diag=$!
sleep 5
screencapture -x "$out/webgltest-screen.png" 2>/dev/null || true
kill "$diag" 2>/dev/null; wait "$diag" 2>/dev/null

ls -la "$out"
if (( failures )); then echo "$failures check(s) failed"; exit 1; fi
echo "all macOS smoke checks passed"
