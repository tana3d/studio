"""Package the signed app with Finder metadata, without GUI automation."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.tmp/dmg-tools'))
import dmgbuild  # noqa: E402
from ds_store import DSStore  # noqa: E402
from mac_alias import Alias  # noqa: E402


def run(*args):
    subprocess.run(args, check=True)


def verify_layout(image, settings):
    with tempfile.TemporaryDirectory(prefix='studio-dmg-check-') as temporary:
        mount = Path(temporary) / 'mounted'
        mount.mkdir()
        subprocess.run(['/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse',
                        '-mountpoint', str(mount), str(image)], check=True,
                       stdout=subprocess.DEVNULL)
        try:
            with DSStore.open(str(mount / '.DS_Store'), 'r') as store:
                for name, point in settings['icon_locations'].items():
                    if store[name]['Iloc'] != point:
                        raise ValueError(f'Installer icon position is incorrect: {name}')
                options = store['.']['icvp']
                if options['backgroundType'] != 2:
                    raise ValueError('Installer background is missing.')
                background = Alias.from_bytes(options['backgroundImageAlias']).target.filename
                if (mount / background).read_bytes() != Path(settings['background']).read_bytes():
                    raise ValueError('Installer background does not match the approved artwork.')
            if not (mount / 'Applications').is_symlink() or os.readlink(mount / 'Applications') != '/Applications':
                raise ValueError('Installer Applications link is incorrect.')
            if (mount / 'Studio.app/Contents/Resources/icon.icns').read_bytes() != Path(settings['icon']).read_bytes():
                raise ValueError('The packaged app has the wrong icon.')
            if os.environ.get('RELEASE_PUBLISH') == 'true':
                run('/usr/bin/codesign', '--verify', '--deep', '--strict', str(mount / 'Studio.app'))
                run('/usr/bin/xcrun', 'stapler', 'validate', str(mount / 'Studio.app'))
        finally:
            run('/usr/bin/hdiutil', 'detach', str(mount))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle-root', required=True, type=Path)
    parser.add_argument('--target', required=True,
                        choices=['aarch64-apple-darwin', 'x86_64-apple-darwin'])
    args = parser.parse_args()
    app = args.bundle_root.resolve() / 'macos/Studio.app'
    with (app / 'Contents/Info.plist').open('rb') as file:
        version = plistlib.load(file)['CFBundleShortVersionString']
    config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
    layout = config['bundle']['macOS']['dmg']
    destination = args.bundle_root.resolve() / 'dmg'
    destination.mkdir(parents=True, exist_ok=True)
    architecture = 'aarch64' if args.target.startswith('aarch64') else 'x64'
    installer = destination / f'Studio_{version}_{architecture}.dmg'
    settings = {
        'files': [str(app)],
        'symlinks': {'Applications': '/Applications'},
        'icon': str(ROOT / 'src-tauri/icons/icon.icns'),
        'background': str((ROOT / 'src-tauri' / layout['background']).resolve()),
        'window_rect': ((100, 100), (layout['windowSize']['width'], layout['windowSize']['height'])),
        'icon_locations': {
            'Studio.app': (layout['appPosition']['x'], layout['appPosition']['y']),
            'Applications': (layout['applicationFolderPosition']['x'], layout['applicationFolderPosition']['y']),
        },
        'icon_size': 128,
        'text_size': 16,
        'hide_extensions': ['Studio.app'],
        'show_toolbar': False,
        'show_status_bar': False,
        'show_sidebar': False,
        'format': 'UDZO',
        'filesystem': 'HFS+',
    }
    # Only a complete, signed image replaces the final installer.
    with tempfile.TemporaryDirectory(prefix='studio-dmg-', dir=destination) as temporary:
        image = Path(temporary) / installer.name
        dmgbuild.build_dmg(str(image), 'Studio', settings=settings)
        identity = config['bundle']['macOS']['signingIdentity'] if os.environ.get('RELEASE_PUBLISH') == 'true' else '-'
        run('/usr/bin/codesign', '--force', '--sign', identity,
            *(['--keychain', os.environ['APPLE_KEYCHAIN_PATH']] if os.environ.get('APPLE_KEYCHAIN_PATH') else []),
            '--timestamp' if identity != '-' else '--timestamp=none', str(image))
        run('/usr/bin/codesign', '--verify', '--strict', str(image))
        verify_layout(image, settings)
        image.replace(installer)
    print(f'Created branded installer: {installer.name}')


if __name__ == '__main__':
    main()
