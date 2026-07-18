#!/usr/bin/env python3
import os
import re
import shutil
import subprocess
import sys
import tempfile

FOLDER_URL = 'https://drive.google.com/drive/folders/17IrJkRGmIU9fDSTU2JQEU9JlFzb5liLJ'
FOLDER_ID = re.search(r'/folders/([\w-]+)', FOLDER_URL).group(1)
REMOTE = 'sorcerydrive'
ART_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'art')


def check_tool(name, install_hint):
    if shutil.which(name) is None:
        print(f'{name} not found. {install_hint}', file=sys.stderr)
        sys.exit(1)


def check_remote():
    remotes = subprocess.run(
        ['rclone', 'listremotes'], check=True, capture_output=True, text=True
    ).stdout.split()
    if f'{REMOTE}:' not in remotes:
        print(
            f"rclone remote '{REMOTE}' not configured. Run this once (opens a "
            f"browser to authorize Google Drive access):\n"
            f"  rclone config create {REMOTE} drive scope=drive.readonly",
            file=sys.stderr,
        )
        sys.exit(1)


def list_remote():
    out = subprocess.run(
        ['rclone', 'lsf', f'{REMOTE}:', '--drive-root-folder-id', FOLDER_ID, '--files-only'],
        check=True, capture_output=True, text=True,
    ).stdout
    return [n for n in out.splitlines() if n]


def target_jpg(name):
    return re.sub(r'\.(png|jpe?g)$', '', name, flags=re.I) + '.jpg'


def select_files(names):
    groups = {}
    rest = []
    for n in names:
        base = re.sub(r'\.(png|jpe?g)$', '', n, flags=re.I)
        m = re.match(r'^(.+)-([sf])$', base)
        if m:
            groups.setdefault(m.group(1), {})[m.group(2)] = n
        else:
            rest.append(n)
    chosen = [g.get('s') or g.get('f') for g in groups.values()] + rest
    return [n for n in chosen if not os.path.exists(os.path.join(ART_DIR, target_jpg(n)))]


def convert_pngs(directory):
    for root, _, files in os.walk(directory):
        for name in files:
            if not name.endswith('.png'):
                continue
            src = os.path.join(root, name)
            dst = src[:-4] + '.jpg'
            subprocess.run(['convert', src, '-quality', '80', dst], check=True)
            os.unlink(src)


check_tool('rclone', 'Install it with: sudo apt install rclone  |  curl https://rclone.org/install.sh | sudo bash')
check_tool('convert', 'Install it with: sudo apt install imagemagick  |  brew install imagemagick')
check_remote()

print('Listing Google Drive folder...')
selected = select_files(list_remote())
if not selected:
    print('Already up to date — nothing to download.')
    sys.exit(0)

tmp_dir = tempfile.mkdtemp(prefix='sorcery-art-')
try:
    list_path = os.path.join(tmp_dir, '_files-from.txt')
    with open(list_path, 'w') as fh:
        fh.write('\n'.join(selected))

    print(f'Downloading {len(selected)} new file(s) from Google Drive...')
    subprocess.run(
        ['rclone', 'copy', f'{REMOTE}:', tmp_dir,
         '--drive-root-folder-id', FOLDER_ID,
         '--files-from', list_path,
         '--drive-acknowledge-abuse', '-P'],
        check=True,
    )
    os.unlink(list_path)

    print('Converting PNGs to JPG...', end='', flush=True)
    convert_pngs(tmp_dir)
    print(' done.')

    os.makedirs(ART_DIR, exist_ok=True)
    copied = 0
    for root, _, files in os.walk(tmp_dir):
        for name in files:
            if not name.endswith('.jpg'):
                continue
            shutil.copy2(os.path.join(root, name), os.path.join(ART_DIR, name))
            copied += 1
            print(f'\r{copied} copied', end='', flush=True)
    print('\nDone.')
finally:
    shutil.rmtree(tmp_dir, ignore_errors=True)
