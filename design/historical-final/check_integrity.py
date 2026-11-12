"""Check this artwork task against its saved working-tree checkpoint."""
from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
before=json.loads((HERE/'process/protected-before.json').read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
changed=[name for name,value in before.items() if not (ROOT/name).is_file() or digest(ROOT/name)!=value]
allowed={
 'extension/scripts/firefox_theme_prototypes.py','extension/scripts/verify-bundle.mjs','extension/tests/themes.test.mjs',
 *[f'extension/{prefix}/themes/{name}' for prefix in ['src/ui/assets','dist/ui'] for name in ['celestial.css','parchment.css','ARTWORK.md']]
}
assert set(changed)<=allowed,changed
release=[name for name in before if name.startswith('extension/release/')]
assert release and all(name not in changed for name in release)
compasses=['celestial/instrument.svg','celestial/orbit.svg','celestial/mark.svg','parchment/rose.svg','parchment/mark.svg']
for p in (ROOT/'extension/src/ui/assets/themes').rglob('*'):
    if p.is_file():assert p.read_bytes()==(ROOT/'extension/dist/ui/themes'/p.relative_to(ROOT/'extension/src/ui/assets/themes')).read_bytes(),p
assets=json.loads((HERE/'process/installed-assets.json').read_text())
for a in assets:assert digest(ROOT/'extension/src/ui/assets/themes'/a['file'])==a['sha256']
native=json.loads((HERE/'native-final/result.json').read_text())
assert native['status']=='PASS',native
earlier=json.loads((ROOT/'docs/evidence/theme-unity/results.json').read_text())
for theme in ['celestial','parchment']:
    assert native['prototypes'][theme]['pinGeometry']==earlier['prototypes'][theme]['pinGeometry'],theme
result={
 'existingFilesChecked':len(before),'releaseFilesUnchanged':len(release),
 'coreAndApplicationSourceUnchanged':True,'generatedJavaScriptMapsHTMLAndManifestUnchanged':True,
 'approvedArtworkUnchanged':compasses,'themeSourceAndDevelopmentAssetsMatch':True,
 'pinGeometryMatchesPreviousNativeEvidence':True,'versionUnchanged':True,
 'changedExistingFiles':changed,'newBundledArtworkBytes':sum(a['bytes'] for a in assets),
 'newPaintedBackgroundBytes':sum(a['bytes'] for a in assets if a['file'].endswith('.webp')),
}
(HERE/'process/integrity.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
