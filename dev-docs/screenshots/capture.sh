#!/usr/bin/env bash
# Capture all 8 documentation screenshots via headless Chrome.
#
# Prereqs:
#   1. Local server running:  python3 -m http.server 8765   (from repo root)
#   2. Google Chrome installed at the standard macOS location.
#
# Usage:
#   bash dev-docs/screenshots/capture.sh

set -euo pipefail

CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
URL_BASE='http://localhost:8765/dev-docs/screenshots/'
OUT_DIR='docs/screenshots'

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at: $CHROME" >&2
  exit 1
fi

if ! curl -s -o /dev/null -w '%{http_code}' "$URL_BASE" | grep -q '^200$'; then
  echo "Local server not responding at $URL_BASE" >&2
  echo "Start one with: python3 -m http.server 8765" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Use a fresh, isolated profile dir so we don't fight with a real Chrome
# session and don't accumulate cruft between runs.
PROFILE_DIR="$(mktemp -d -t feedmeter-shot-XXXXXX)"
trap 'rm -rf "$PROFILE_DIR"' EXIT

# Names match the canonical filenames in docs/screenshots/README.md.
NAMES=(home tile-live bottle-save comfort edit-entry weight settings conflict chain-bottle chain)

# Capture by spawning Chrome detached and polling for the screenshot file.
# Chrome 148 reliably writes the PNG within a couple of seconds but often
# hangs on background-network housekeeping after that, so waiting for the
# process to exit is much slower than waiting for the file. We kill Chrome
# the moment the file appears (or a hard limit fires).
#
# Flag rationale:
#   --window-size=390,844: Chrome 148's --headless=new ignores this for
#     layout (it always lays out at ~500x757) but DOES use it to clip the
#     screenshot. The fixture's CSS forces the document to 390px wide so
#     content fits inside the clip.
#   --virtual-time-budget=4000: fast-forwards setTimeouts inside the page
#     so the fixture's runCapture() (clicks, waits, modal opens) finishes
#     before the screenshot is taken.
#   --no-first-run / --disable-component-update / --disable-background-
#     networking / --no-default-browser-check: suppress Chrome's auto-
#     update and first-run network chatter that otherwise stalls exit.

capture_one() {
  local name="$1" out="$2" url="$3"
  rm -f "$out"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-default-browser-check \
    --no-first-run \
    --disable-component-update \
    --disable-background-networking \
    --user-data-dir="$PROFILE_DIR/$name" \
    --window-size=390,844 \
    --virtual-time-budget=4000 \
    --screenshot="$out" \
    "$url" \
    > /dev/null 2>&1 &
  local cpid=$!
  # Poll up to 15 s for the file. Most captures land in 2–5 s.
  for _ in $(seq 1 15); do
    sleep 1
    [[ -s "$out" ]] && break
  done
  # Give Chrome a beat to finish flushing, then kill it.
  sleep 1
  kill -9 "$cpid" 2>/dev/null || true
  wait "$cpid" 2>/dev/null || true
}

for name in "${NAMES[@]}"; do
  out="$OUT_DIR/${name}.png"
  url="${URL_BASE}?capture=${name}"
  echo "[capture] $name -> $out"
  capture_one "$name" "$out" "$url"
  if [[ ! -s "$out" ]]; then
    echo "  ERROR: $out was not produced" >&2
  fi
done

echo
echo "Done. Captured screenshots:"
ls -lh "$OUT_DIR"/*.png
