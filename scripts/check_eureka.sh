#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/verify_eureka.mjs
node --check web/server.mjs
node --check web/app.mjs
node --check web/eureka.mjs
node --check web/eureka-quality.mjs
node --test tests/*.test.mjs
echo 'EUREKA verification complete. Start with: bash scripts/run.sh'
