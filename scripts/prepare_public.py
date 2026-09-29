#!/usr/bin/env python3
"""Create a source-only share directory and archive from an explicit file list."""
import hashlib
import json
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'absolute home directory': re.compile(r'/(?:Users|home)/[A-Za-z0-9_.-]+/'),
    'private conversation link': re.compile(r'codex://threads/[0-9a-f-]{20,}'),
    'private key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub credential': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b'),
    'API credential': re.compile(r'\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b'),
}


def main():
    names = json.loads((ROOT / 'public-files.json').read_text())
    if len(names) != len(set(names)):
        raise SystemExit('Duplicate entries in public-files.json')
    files = {}
    for name in names:
        rel = Path(name)
        if rel.is_absolute() or '..' in rel.parts:
            raise SystemExit(f'Invalid public path: {name}')
        path = ROOT / rel
        if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != ROOT):
            raise SystemExit(f'Symlink is not allowed: {name}')
        data = path.read_bytes()
        if len(data) > 1_000_000:
            raise SystemExit(f'Unexpectedly large source file: {name}')
        if rel.suffix == '.png':
            if not data.startswith(b'\x89PNG\r\n\x1a\n'):
                raise SystemExit(f'Invalid PNG image: {name}')
            # Images are explicitly listed and visually reviewed before publishing.
            files[name] = data
            continue
        text = data.decode('utf-8')
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                # Report the file and category, never a possible credential.
                raise SystemExit(f'Review required: {label} in {name}')
        files[name] = data

    output = ROOT / 'output'
    output.mkdir(exist_ok=True)
    target = output / 'public-source'
    if target.is_symlink():
        raise SystemExit('Public output directory must not be a symlink')
    if target.exists():
        actual = {p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}
        if actual - files.keys() or any(p.is_symlink() for p in target.rglob('*')):
            raise SystemExit('Public output has extra files; preserve it elsewhere before rebuilding')
    for name, data in files.items():
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o755 if name.endswith(".command") else 0o644)

    version = json.loads(files['package.json'])['version']
    archive = output / f'typora-codex-mermaid-{version}-source.tar.gz'
    with tarfile.open(archive, 'w:gz') as package:
        for name in sorted(files):
            info = package.gettarinfo(str(target / name), arcname=f'typora-codex-mermaid/{name}')
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mode = 0o755 if name.endswith(".command") else 0o644
            with (target / name).open('rb') as stream:
                package.addfile(info, stream)
    report = {
        'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())},
        'archive': archive.name,
        'archiveSHA256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'checks': 'Explicit file list; PNG signature or UTF-8; size; symlinks; common personal paths and credential markers',
        'limitation': 'Pattern checks do not replace source review or prove the absence of all sensitive data.',
    }
    (output / 'public-manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Prepared {len(files)} source files in output/public-source/')
    print(f'Archive: output/{archive.name}')


if __name__ == '__main__':
    main()
