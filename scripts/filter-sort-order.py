#!/usr/bin/env python3
# Git clean filter for .obsidian/plugins/manual-sorting/data.json.
# Strips all per-folder sort orders except the root "/", keeping git diffs silent
# when the Manual Sorting plugin rewrites its data file.
#
# One-time setup per clone (run from the repo root):
#   git config filter.sortorder.clean "python3 scripts/filter-sort-order.py"

import json
import sys

data = json.load(sys.stdin)
root_order = data.get('customOrder', {}).get('/')
data['customOrder'] = {'/' : root_order} if root_order is not None else {}
print(json.dumps(data, indent=2))
