#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_python_version=$(cat .python-version)
if command -v uv >/dev/null 2>&1; then
  uv python install "$task_python_version"
  if [ ! -f .venv/bin/python ]; then uv venv --python "$task_python_version" .venv; fi
  .venv/bin/python -c 'import sys; assert sys.version_info[:3] == (3,12,14), "Use a fresh checkout: this project .venv has a different Python version."'
  uv pip install --python .venv/bin/python -r requirements.txt
else
  if command -v python3.12 >/dev/null 2>&1; then task_python=python3.12; else task_python=python3; fi
  "$task_python" -c 'import sys; assert sys.version_info[:3] == (3,12,14), "Install uv 0.13.4 from Astral, or Python 3.12.14. The web app does not need Python."'
  "$task_python" -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
fi
bash scripts/verify_science.sh
