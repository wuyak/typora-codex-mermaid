#!/usr/bin/env python3
"""Package the offline renderer and system-Perl installer for macOS users."""
import json
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST_FILES = (
    'main.js', 'engine.js', 'renderer.js', 'viewer.js',
    'manifest.json', 'NOTICE', 'THIRD_PARTY_NOTICES.txt',
)


def main():
    package = json.loads((ROOT / 'package.json').read_text())
    manifest_path = ROOT / 'dist/manifest.json'
    if not manifest_path.exists():
        raise SystemExit('Missing dist/manifest.json. Run npm run extract and npm run build first.')
    manifest = json.loads(manifest_path.read_text())
    if manifest['version'] != package['version']:
        raise SystemExit('Build version does not match package.json; run npm run build again.')
    mapping = {
        'Install.command': 'Install.command',
        'Uninstall.command': 'Uninstall.command',
        'scripts/manage.pl': 'scripts/manage.pl',
        'README.md': 'README.md',
        'NOTICE': 'NOTICE',
        'docs/INSTALL.md': 'docs/INSTALL.md',
        'docs/DEVELOPMENT.md': 'docs/DEVELOPMENT.md',
        'examples/demo.md': 'examples/demo.md',
        'examples/usage-preview.png': 'examples/usage-preview.png',
        'examples/knowledge-search.mmd': 'examples/knowledge-search.mmd',
        'examples/knowledge-search.svg': 'examples/knowledge-search.svg',
        'examples/publishing-workflow.mmd': 'examples/publishing-workflow.mmd',
        'examples/publishing-workflow.svg': 'examples/publishing-workflow.svg',
        'examples/plugin-overview.svg': 'examples/plugin-overview.svg',
        'examples/plugin-overview.mmd': 'examples/plugin-overview.mmd',
        **{f'dist/{name}': f'dist/{name}' for name in DIST_FILES},
    }
    files = {}
    for destination, source in mapping.items():
        path = ROOT / source
        if path.is_symlink():
            raise SystemExit(f'Package inputs must not be symlinks: {source}')
        files[destination] = path.read_bytes()
    output = ROOT / 'output'
    output.mkdir(exist_ok=True)
    name = f"typora-codex-mermaid-{package['version']}-macos"
    archive = output / f'{name}.zip'
    temporary = archive.with_suffix('.zip.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as target:
            for relative, data in sorted(files.items()):
                info = zipfile.ZipInfo(f'{name}/{relative}')
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                mode = 0o755 if relative.endswith('.command') else 0o644
                info.external_attr = (stat.S_IFREG | mode) << 16
                target.writestr(info, data)
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Created output/{archive.name}: {len(files)} files, {archive.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
