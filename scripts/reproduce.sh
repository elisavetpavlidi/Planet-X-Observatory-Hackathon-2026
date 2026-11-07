#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24.22.1 from https://nodejs.org/ and run this script again.' >&2
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js 22 or later is required; release tested with 24.22.1.");process.exit(1)}'
node scripts/verify_package.mjs
node scripts/build_reference.mjs --check
node --test tests/*.test.mjs
echo 'Planet X 1.1.0 verified. Start the app: bash scripts/run.sh'
