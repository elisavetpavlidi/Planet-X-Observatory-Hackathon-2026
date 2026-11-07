"""A source fingerprint also works for ZIP downloads without Git metadata."""
from pathlib import Path
from hashlib import sha256


def source_fingerprint():
    root=Path(__file__).resolve().parents[1]
    paths=[root/'package.json',root/'requirements.txt']+sorted((root/'web').glob('*.mjs'))+sorted((root/'planetx').glob('*.py'))
    digest=sha256()
    for path in paths:
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode());digest.update(b'\0');digest.update(path.read_bytes())
    return digest.hexdigest()
