"""Refresh the bundled DATA snapshot from the official project at an immutable revision.

No upstream executable is fetched or run. Review the resulting data/metadata diff.
Runtime validation is performed by the extension parser before activation.
"""
import hashlib
from datetime import datetime, timezone
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'data' / 'stevenblack'
PATH = 'alternates/fakenews-gambling-porn-social/hosts'
headers = {'User-Agent': 'Atlas-prototype-snapshot', 'Accept': 'application/vnd.github+json'}
request = urllib.request.Request(f'https://api.github.com/repos/StevenBlack/hosts/commits?path={PATH}&per_page=1', headers=headers)
with urllib.request.urlopen(request, timeout=30) as response:
    revision = json.load(response)[0]['sha']
source = f'https://raw.githubusercontent.com/StevenBlack/hosts/{revision}/{PATH}'
with urllib.request.urlopen(source, timeout=60) as response:
    data = response.read(20_000_001)
if len(data) > 20_000_000 or b'StevenBlack' not in data[:4000] or b'Number of unique domains:' not in data[:4000]:
    raise SystemExit('Unexpected or oversized upstream data')
ROOT.mkdir(parents=True, exist_ok=True)
(ROOT / 'hosts').write_bytes(data)
(ROOT / 'metadata.json').write_text(json.dumps({'sourceUrl': source, 'revision': revision,
    'sha256': hashlib.sha256(data).hexdigest(), 'bundledOn': datetime.now(timezone.utc).date().isoformat()}, indent=2) + '\n', encoding='utf-8')
for remote, local in [('license.txt', 'license.txt'), (f'alternates/fakenews-gambling-porn-social/readme.md', 'upstream-readme.md')]:
    with urllib.request.urlopen(f'https://raw.githubusercontent.com/StevenBlack/hosts/{revision}/{remote}', timeout=30) as response:
        (ROOT / local).write_bytes(response.read())
print(json.dumps({'revision': revision, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}))
