"""Build and verify a Finder-independent drag-to-install disk image."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import dmgbuild
from ds_store import DSStore


def run(*args):
    return subprocess.run(args, check=True, capture_output=True).stdout


def build(app, output):
    app = app.resolve(strict=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    signed = os.environ.get('MACOS_SIGNING_MODE') == 'developer-id'
    run('codesign', '--verify', '--deep', '--strict', str(app))
    if signed:
        # A valid signature alone is not notarization. Fail the release if its
        # ticket is missing or Gatekeeper rejects the resulting application.
        run('xcrun', 'stapler', 'validate', str(app))
        run('spctl', '--assess', '--type', 'execute', '--verbose=2', str(app))
    positions = {'LarkAnything.app': (140, 120), 'Applications': (500, 120)}
    dmgbuild.build_dmg(str(output), 'LarkAnything · 拖入 Applications', settings={
        'format': 'UDZO', 'filesystem': 'HFS+',
        'files': [str(app)], 'symlinks': {'Applications': '/Applications'},
        'icon': str(Path('src-tauri/icons/icon.icns').resolve()),
        'background': 'builtin-arrow', 'window_rect': ((160, 160), (640, 280)),
        'default_view': 'icon-view', 'include_icon_view_settings': True,
        'show_status_bar': False, 'show_tab_view': False, 'show_toolbar': False,
        'show_pathbar': False, 'show_sidebar': False, 'arrange_by': None,
        'icon_size': 96, 'text_size': 14, 'grid_spacing': 80,
        # SetFile -a E on the signed app adds FinderInfo and breaks codesign.
        # Keep all layout metadata in the volume's .DS_Store instead.
        'icon_locations': positions,
    })
    run('hdiutil', 'verify', str(output))
    # Inspect the actual image, not just the source settings or build exit code.
    with tempfile.TemporaryDirectory(prefix='la-dmg-verify-') as mount:
        mounted = False
        try:
            run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', mount, str(output))
            mounted = True
            volume = Path(mount)
            if not (volume / 'LarkAnything.app/Contents/MacOS/larkanything-desktop').is_file():
                raise RuntimeError('DMG application missing')
            if not (volume / 'Applications').is_symlink() or os.readlink(volume / 'Applications') != '/Applications':
                raise RuntimeError('Applications shortcut missing')
            with DSStore.open(str(volume / '.DS_Store'), 'r') as store:
                for name, expected in positions.items():
                    if tuple(store[name]['Iloc']) != expected:
                        raise RuntimeError(f'DMG icon position mismatch: {name}')
                view = store['.']['icvp']
                if view['iconSize'] != 96 or view['backgroundType'] != 2:
                    raise RuntimeError('DMG icon view/background missing')
            run('codesign', '--verify', '--deep', '--strict', str(volume / 'LarkAnything.app'))
            if signed:
                run('xcrun', 'stapler', 'validate', str(volume / 'LarkAnything.app'))
                run('spctl', '--assess', '--type', 'execute', '--verbose=2', str(volume / 'LarkAnything.app'))
        finally:
            if mounted:
                run('hdiutil', 'detach', mount)
    report = {'layout': 'verified', 'applicationShortcut': 'verified',
              'appSignature': 'verified', 'notarization': 'verified' if signed else 'not-configured',
              'windowSize': [640, 280], 'iconPositions': positions,
              'visualAcceptance': 'Requires opening on a real Mac'}
    output.with_suffix('.verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        build(Path(sys.argv[1]), Path(sys.argv[2]))
    except subprocess.CalledProcessError as error:
        # Commands here contain no credentials; keep reports concise.
        print(f'Packaging verification failed: {error.cmd[0]} (exit {error.returncode})', file=sys.stderr)
        print(error.stderr.decode(errors='replace')[-2000:], file=sys.stderr)
        sys.exit(1)
