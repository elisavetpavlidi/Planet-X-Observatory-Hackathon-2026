#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22 or later is required: https://nodejs.org/' >&2
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js 22 or later is required.");process.exit(1)}'
echo 'Open: http://127.0.0.1:8501'
exec node web/server.mjs
