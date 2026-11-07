#!/usr/bin/env bash
set -euo pipefail

# EUREKA Open Astronomy v4 — full repository import.
# This imports the ORIGINAL uploaded ZIP, including FITS, data, source code and documentation.
REPO="https://github.com/elisavetpavlidi/Planet-X-Observatory-Hackathon-2026.git"
ZIP="${1:-$HOME/Downloads/EUREKA_Open_Astronomy_FULL_v4.zip}"

if [ ! -f "$ZIP" ]; then
  echo "Cannot find the full EUREKA v4 ZIP: $ZIP" >&2
  echo "Usage: bash tools/IMPORT_FULL_EUREKA_V4.sh /full/path/to/EUREKA_Open_Astronomy_FULL_v4.zip" >&2
  exit 1
fi

command -v git >/dev/null || { echo "git is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

DEST="$HOME/Desktop/EUREKA-GitHub-Import-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
echo "Cloning repository into $DEST ..."
git clone "$REPO" "$DEST/repository"

echo "Copying and verifying every file from $ZIP ..."
python3 - "$ZIP" "$DEST/repository" <<'PY'
import hashlib
import pathlib
import sys
import zipfile

archive_path, destination = sys.argv[1:]
target = pathlib.Path(destination).resolve()
with zipfile.ZipFile(archive_path) as archive:
    entries = [x for x in archive.infolist() if not x.is_dir()]
    prefix = "EUREKA_Open_Astronomy_FULL_v4/"
    if any(not info.filename.startswith(prefix) for info in entries):
        raise SystemExit("Unexpected ZIP layout; no files were published.")
    count = 0
    for info in entries:
        relative = pathlib.PurePosixPath(info.filename.removeprefix(prefix))
        if not relative.parts or any(p in ("..", ".", "") for p in relative.parts):
            raise SystemExit(f"Unsafe ZIP entry: {info.filename}")
        out = target.joinpath(*relative.parts)
        if not out.resolve().is_relative_to(target):
            raise SystemExit(f"Unsafe ZIP destination: {info.filename}")
        out.parent.mkdir(parents=True, exist_ok=True)
        raw = archive.read(info)
        out.write_bytes(raw)
        if hashlib.sha256(out.read_bytes()).digest() != hashlib.sha256(raw).digest():
            raise SystemExit(f"Copy failed: {relative}")
        count += 1
    if count != 175:
        raise SystemExit(f"Expected 175 files; ZIP contains {count}. Check the source ZIP.")
    print(f"Verified {count} files. All bytes match the source ZIP.")
PY

cd "$DEST/repository"
echo "Reviewing Git changes and preparing first full import ..."
git status --short
git add -A
if git diff --cached --quiet; then
  echo "Nothing to publish. Repository already matches the ZIP."
  exit 0
fi

if ! git config user.name >/dev/null; then
  echo "Your Git commit identity is missing. Run: git config --global user.name 'Your Name'" >&2
  exit 1
fi
if ! git config user.email >/dev/null; then
  echo "Your Git commit email is missing. Configure a GitHub email (noreply is fine)." >&2
  exit 1
fi

git commit -m "Import full EUREKA Open Astronomy v4 source and observations"
echo "Publishing the complete EUREKA package to GitHub ..."
git push origin main
echo
echo "DONE: GitHub now has the complete ZIP contents, including the original FITS."
echo "Repository: https://github.com/elisavetpavlidi/Planet-X-Observatory-Hackathon-2026"
echo "Local checkout: $DEST/repository"
