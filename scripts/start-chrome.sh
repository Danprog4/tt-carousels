#!/usr/bin/env bash
set -euo pipefail

CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RESEARCH_PROFILE="$HOME/Library/Application Support/Google/Chrome-TikTok-Research"
DEBUG_ENDPOINT="http://127.0.0.1:9222/json/version"

if curl --silent --fail "$DEBUG_ENDPOINT" >/dev/null 2>&1; then
  echo "Research Chrome is already connected on port 9222."
  exit 0
fi

if [[ ! -x "$CHROME_APP" ]]; then
  echo "Google Chrome was not found in /Applications." >&2
  exit 1
fi

mkdir -p "$RESEARCH_PROFILE"
nohup "$CHROME_APP" \
  --user-data-dir="$RESEARCH_PROFILE" \
  --profile-directory="Default" \
  --remote-debugging-port=9222 \
  --mute-audio \
  --no-first-run \
  --no-default-browser-check \
  "https://www.tiktok.com/" \
  > /tmp/tt-carousel-chrome.log 2>&1 &

echo "Research Chrome started. Keep it open while searching TikTok."
