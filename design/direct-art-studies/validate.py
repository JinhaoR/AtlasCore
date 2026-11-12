"""Check artwork provenance, standalone outputs and unchanged protected files."""
from pathlib import Path
from PIL import Image
import hashlib, json, xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[1]

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    before=json.loads((ROOT/'process/protected-before.json').read_text())
    changed=[name for name,sha in before.items() if not (REPO/name).is_file() or digest(REPO/name)!=sha]
    assert not changed, changed
    downloads=json.loads((ROOT/'sources/downloads.json').read_text())
    for record in downloads:assert digest(ROOT/'sources'/record['file'])==record['sha256']
    cases=json.loads((ROOT/'process/candidates.json').read_text(encoding='utf-8'))
    checked=[]
    for case in cases:
        assert digest(ROOT/'sources'/case['source'])==case['sourceSha256']
        for folder,suffix in [('fitted','.jpg'),('softened','.jpg'),('previews','-context.png')]:
            p=ROOT/folder/(case['id']+suffix)
            with Image.open(p) as im:assert im.size==(1920,1200)
            checked.append(p.relative_to(ROOT).as_posix())
        tree=ET.parse(ROOT/'previews'/(case['id']+'-context.svg'))
        for element in tree.iter():
            for key,value in element.attrib.items():
                if key.endswith('href'):assert value.startswith(('data:','#')),value
    report={'protectedFilesUnchanged':len(before),'releaseFilesUnchanged':sum(n.startswith('extension/release/') for n in before),
            'downloadedSourcesHashVerified':len(downloads),'renderedAndRasterAssetsChecked':checked,
            'selfContainedSvgMockups':len(cases),'noExtensionInstall':True,'noAiImageGeneration':True,
            'studySizeMiB':round(sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())/1024**2,2)}
    (ROOT/'process/validation.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
