#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
.venv/bin/python -m planetx.cli verify-data
.venv/bin/python -m pytest -q
.venv/bin/python scripts/science_report.py
