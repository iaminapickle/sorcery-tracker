#!/usr/bin/env python3
# Downloads official card art from the Sorcery TCG Google Drive folder.
# Requires gdown and ImageMagick: pip install gdown
# Usage: python3 scripts/download-art.py

import os
import re
import shutil
import subprocess
import sys
import tempfile

FOLDER_URL = 'https://drive.google.com/drive/folders/17IrJkRGmIU9fDSTU2JQEU9JlFzb5liLJ'
ART_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'art')


def check_tool(name, install_hint):
    if shutil.which(name) is None:
        print(f'{name} not found. {install_hint}', file=sys.stderr)
        sys.exit(1)


def convert_pngs(directory):
    for root, _, files in os.walk(directory):
        for name in files:
            if not name.endswith('.png'):
                continue
            src = os.path.join(root, name)
            dst = src[:-4] + '.jpg'
            subprocess.run(['convert', src, '-quality', '80', dst], check=True)
            os.unlink(src)


def find_jpgs(directory):
    results = []
    for root, _, files in os.walk(directory):
        for name in files:
            if name.endswith('.jpg'):
                results.append({'name': name, 'src': os.path.join(root, name)})
    return results


def select_files(files):
    groups = {}
    rest = []
    for f in files:
        m = re.match(r'^(.+)-([sf])\.jpg$', f['name'])
        if m:
            base, variant = m.group(1), m.group(2)
            groups.setdefault(base, {})[variant] = f
        else:
            rest.append(f)
    return [g.get('s') or g.get('f') for g in groups.values()] + rest


check_tool('gdown', 'Install it with: pip install gdown')
check_tool('convert', 'Install it with: sudo apt install imagemagick  |  brew install imagemagick')

tmp_dir = tempfile.mkdtemp(prefix='sorcery-art-')
try:
    print('Downloading from Google Drive (this may take a while)...')
    subprocess.run(['gdown', '--folder', FOLDER_URL, '-O', tmp_dir, '--remaining-ok'], check=True)

    print('Converting PNGs to JPG...', end='', flush=True)
    convert_pngs(tmp_dir)
    print(' done.')

    all_files = find_jpgs(tmp_dir)
    selected = select_files(all_files)
    print(f'\n{len(all_files)} downloaded, {len(selected)} selected after -s/-f filtering')

    os.makedirs(ART_DIR, exist_ok=True)
    copied = skipped = 0
    for f in selected:
        dest = os.path.join(ART_DIR, f['name'])
        if os.path.exists(dest):
            skipped += 1
            continue
        shutil.copy2(f['src'], dest)
        copied += 1
        print(f'\r{copied} copied, {skipped} skipped', end='', flush=True)
    print('\nDone.')
finally:
    shutil.rmtree(tmp_dir, ignore_errors=True)
