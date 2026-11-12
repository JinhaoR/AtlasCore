"""Download the specifically reviewed public-domain reproductions, no API keys."""
from pathlib import Path
import hashlib
import json
import urllib.request
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ('aguiar-1492.jpg', 'Jorge Aguiar 1492 MR.jpg', 3840),
    ('doppelmayr-1730.jpg', '1730 celestial map of the Northern Hemisphere Sky.jpg', 1280),
    ('doppelmayr-systems.jpg', 'Atlas Novus Coelestis by Johann Gabriel Doppelmayr (1742) 001.jpg', 3840),
    ('cellarius-copernican.jpg', 'Cellarius Harmonia Macrocosmica - Scenographia Systematis Copernicani.jpg', None),
    ('blaeu-world.png', 'Willem Blaeu - Nova totius terrarum orbis geographica ac hydrographica tabula.png', 3840),
    ('blaeu-capitanata.jpg', '1630 Blaeu Map of Capitanata ( Foggia ), Italy - Geographicus - Capitanata-blaeu-1630.jpg', None),
]

if __name__ == '__main__':
    (ROOT / 'sources').mkdir(exist_ok=True)
    receipt = []
    for local, name, width in SOURCES:
        name = name.replace(' ', '_')
        digest = hashlib.md5(name.encode()).hexdigest()
        path = f'{digest[0]}/{digest[:2]}/{quote(name)}'
        url = f'https://upload.wikimedia.org/wikipedia/commons/{path}'
        if width:
            url = f'https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/{width}px-{quote(name)}'
        target = ROOT / 'sources' / local
        if not target.exists():
            req = urllib.request.Request(url, headers={'User-Agent': 'AtlasArtworkStudy/1.0 (public-domain artwork research)'})
            target.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        receipt.append({'file': local, 'url': url, 'page': 'https://commons.wikimedia.org/wiki/File:' + quote(name), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        print(local, target.stat().st_size)
    (ROOT / 'sources/downloads.json').write_text(json.dumps(receipt, indent=2))
