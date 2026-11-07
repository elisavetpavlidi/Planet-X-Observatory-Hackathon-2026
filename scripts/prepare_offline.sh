#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Run on EACH presentation laptop, while online. Wheels are platform-specific.
.venv/bin/python -m pip download --only-binary=:all: -r requirements.txt -d wheelhouse
echo 'Save this folder + wheelhouse on your laptop and backup drive.'
