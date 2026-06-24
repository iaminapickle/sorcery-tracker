#!/usr/bin/env python3
# Recompresses all JPEG files in assets/art/ at the given quality (1-100, default 80).
# Files are replaced in-place — no renaming, no new files.
# Usage: python3 scripts/recompress-art.py [quality]

import glob
import os
import shutil
import subprocess
import sys

quality = int(sys.argv[1]) if len(sys.argv) > 1 else 80
if not 1 <= quality <= 100:
    print('Error: quality must be a number between 1 and 100', file=sys.stderr)
    sys.exit(1)

if shutil.which('mogrify') is None:
    print('Error: ImageMagick is required (WSL/Linux: sudo apt install imagemagick  |  macOS: brew install imagemagick)', file=sys.stderr)
    sys.exit(1)

art_dir = os.path.join(os.path.dirname(__file__), '..', 'assets', 'art')
files = glob.glob(os.path.join(art_dir, '*.[jJ][pP][gG]')) + glob.glob(os.path.join(art_dir, '*.[jJ][pP][eE][gG]'))

if not files:
    print(f'No JPEG files found in {art_dir}')
    sys.exit(0)

print(f'Recompressing {len(files)} files at quality {quality}...')
subprocess.run(['mogrify', '-quality', str(quality)] + files, check=True)
print('Done.')
