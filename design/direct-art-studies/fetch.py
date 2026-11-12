"""Download only the file-specific public-domain reproductions selected for this study."""
from pathlib import Path
import hashlib, json, urllib.request

ROOT = Path(__file__).resolve().parent
SOURCES = [
    ('prunes-1559.jpg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/%28Chart_of_the_Mediterranean%2C_Black_Sea%2C_and_the_coasts_of_western_Europe_and_northwest_Africa%29_LOC_2014588812.jpg/1920px-%28Chart_of_the_Mediterranean%2C_Black_Sea%2C_and_the_coasts_of_western_Europe_and_northwest_Africa%29_LOC_2014588812.jpg', 'https://commons.wikimedia.org/wiki/File:(Chart_of_the_Mediterranean,_Black_Sea,_and_the_coasts_of_western_Europe_and_northwest_Africa)_LOC_2014588812.jpg'),
    ('de-wit-1680.jpg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg/3840px-1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg', 'https://commons.wikimedia.org/wiki/File:1680_Planisphaerium_Coeleste_by_Frederik_de_Wit.jpg'),
    ('oliva-17c.jpg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg/3840px-17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg', 'https://commons.wikimedia.org/wiki/File:17th-century_Portolan_chart_of_the_Mediterranean_Sea_by_a_member_of_the_Oliva_family.jpg'),
    ('vlasbloem-1675.jpg', 'https://upload.wikimedia.org/wikipedia/commons/a/a3/1675_double_hemisphere_celestial_chart_by_Louis_Vlasbloem.jpg', 'https://commons.wikimedia.org/wiki/File:1675_double_hemisphere_celestial_chart_by_Louis_Vlasbloem.jpg'),
]

if __name__ == '__main__':
    (ROOT/'sources').mkdir(parents=True, exist_ok=True)
    records = []
    for name, url, page in SOURCES:
        target = ROOT/'sources'/name
        if not target.exists():
            request = urllib.request.Request(url, headers={'User-Agent':'AtlasArtworkStudy/1.0 (public-domain art research)'})
            with urllib.request.urlopen(request, timeout=60) as response:
                target.write_bytes(response.read())
        records.append({'file':name, 'url':url, 'page':page, 'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
        print(name, target.stat().st_size, flush=True)
    (ROOT/'sources/downloads.json').write_text(json.dumps(records, indent=2))
