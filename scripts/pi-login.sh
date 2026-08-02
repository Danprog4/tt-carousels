#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [[ -n "${PI_NODE_EXECUTABLE:-}" ]]; then
  NODE_EXECUTABLE="$PI_NODE_EXECUTABLE"
else
  NODE_EXECUTABLE="$(command -v node)"
fi

NODE_OK="$($NODE_EXECUTABLE -p 'const [major, minor] = process.versions.node.split(".").map(Number); Number(major > 22 || (major === 22 && minor >= 19))')"
if [[ "$NODE_OK" != "1" && -x "$BUNDLED_NODE" ]]; then
  NODE_EXECUTABLE="$BUNDLED_NODE"
  NODE_OK="$($NODE_EXECUTABLE -p 'const [major, minor] = process.versions.node.split(".").map(Number); Number(major > 22 || (major === 22 && minor >= 19))')"
fi
if [[ "$NODE_OK" != "1" ]]; then
  echo "Pi requires Node 22.19 or newer; found $($NODE_EXECUTABLE --version)." >&2
  echo "Set PI_NODE_EXECUTABLE to a compatible Node binary and retry." >&2
  exit 1
fi

exec "$NODE_EXECUTABLE" \
  "$PROJECT_DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-context-files \
  --no-session
