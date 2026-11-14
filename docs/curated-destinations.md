# Current curated Atlas destinations - 0.1.19 development (2026-10-29)

294 exact hostnames across 122 services. Relative to signed 0.1.18, only the four Wikipedia defaults are omitted; all other catalog hosts are unchanged. YouTube remains omitted. No subdomain scope is enabled by the preset.

Each service occurs once with explicit aliases and distinct entry points. These default terms are exact hostnames: there is no wildcard, parent-domain or global apex/www equivalence. The optional [subdomain scope](whitelist-scopes.md) is a separate explicit Vault choice.

Existing custom Whitelist entries and saved Wikipedia permissions are preserved. Frozen v2 receipts prevent an existing 0.1.18 installation from receiving the expansion again; fresh or unmigrated installations use the 294-host v3 set. Legacy Wikipedia display metadata exists only to preserve saved grouping, pins and frozen drafts. See [0.1.19 behavior](version-history.md#v0-1-19).

The [public host evidence](evidence/curated-hosts-2026-10.json) is the unchanged historical 0.1.18 record, which also contains the now-omitted Wikipedia entries. This correction adds no new hosts and makes no new live-verification claim. Signed 0.1.18 retains its original 298-host catalog in its frozen source archive.

| Category | Service | Primary hostname | Explicit aliases | Distinct destinations |
| --- | --- | --- | --- | --- |
| AI | ChatGPT | chatgpt.com | - | - |
| AI | Claude | claude.ai | - | - |
| Mail | Gmail | mail.google.com | - | - |
| Mail | KTH Mail | webmail.kth.se | - | - |
| Mail | Outlook | outlook.com | www.outlook.com | outlook.live.com, outlook.office.com, outlook.office365.com, outlook.cloud.microsoft |
| Mail | Microsoft 365 | microsoft365.com | www.microsoft365.com | m365.cloud.microsoft, office.com, www.office.com, www.microsoft.com |
| Scholar / Research | Google Scholar | scholar.google.com | - | - |
| Scholar / Research | arXiv | arxiv.org | - | - |
| Scholar / Research | INSPIRE | inspirehep.net | - | - |
| Scholar / Research | DOI | doi.org | - | www.doi.org |
| Scholar / Research | Crossref | crossref.org | - | www.crossref.org |
| Scholar / Research | ORCID | orcid.org | - | - |
| Scholar / Research | Semantic Scholar | semanticscholar.org | www.semanticscholar.org | - |
| Scholar / Research | APS | journals.aps.org | - | link.aps.org, aps.org, www.aps.org, physics.aps.org |
| Scholar / Research | AIP | pubs.aip.org | - | - |
| Scholar / Research | IOPscience | iopscience.iop.org | - | - |
| Scholar / Research | Nature | nature.com | www.nature.com | - |
| Scholar / Research | Science | science.org | www.science.org | - |
| Scholar / Research | ScienceDirect | sciencedirect.com | www.sciencedirect.com | - |
| Scholar / Research | Springer | springer.com | - | link.springer.com |
| Scholar / Research | Wiley Online Library | onlinelibrary.wiley.com | - | - |
| Scholar / Research | Oxford Academic | academic.oup.com | - | - |
| Scholar / Research | Cambridge | cambridge.org | www.cambridge.org | - |
| Scholar / Research | JSTOR | jstor.org | www.jstor.org | - |
| Scholar / Research | IEEE Xplore | ieeexplore.ieee.org | - | - |
| Scholar / Research | ACM Digital Library | dl.acm.org | - | - |
| Scholar / Research | PubMed / NCBI | pubmed.ncbi.nlm.nih.gov | - | ncbi.nlm.nih.gov |
| Scholar / Research | Zotero | zotero.org | www.zotero.org | - |
| Scholar / Research | Zenodo | zenodo.org | - | - |
| Scholar / Research | OSF | osf.io | - | - |
| Scholar / Research | OpenAlex | openalex.org | - | - |
| Scholar / Research | DOAJ | doaj.org | - | - |
| Scholar / Research | DBLP | dblp.org | - | - |
| Scholar / Research | PubMed Central | pmc.ncbi.nlm.nih.gov | - | - |
| Scholar / Research | ACS Publications | pubs.acs.org | - | - |
| Scholar / Research | Royal Society Publishing | royalsocietypublishing.org | - | - |
| Scholar / Research | SIAM Publications | epubs.siam.org | - | - |
| Scholar / Research | SciPost | scipost.org | - | - |
| Writing | Overleaf | overleaf.com | www.overleaf.com | - |
| University | Ladok | student.ladok.se | - | - |
| University | Canvas | canvas.kth.se | - | canvas.instructure.com, learn.canvas.net |
| University | KTH | kth.se | www.kth.se | intra.kth.se, www.physics.kth.se, physics.kth.se |
| University | Stockholm University | su.se | www.su.se | fysik.su.se, www.fysik.su.se |
| University | Karolinska Institutet | ki.se | www.ki.se | - |
| University | Uppsala University | uu.se | www.uu.se | physics.uu.se, www.physics.uu.se, www.it.uu.se, user.it.uu.se |
| University | Lund University | lu.se | www.lu.se | www.fysik.lu.se, www.matfys.lu.se |
| University | Chalmers | chalmers.se | www.chalmers.se | - |
| University | University of Gothenburg | gu.se | www.gu.se | - |
| University | Linkoping University | liu.se | www.liu.se | www.ifm.liu.se |
| University | Umea University | umu.se | www.umu.se | - |
| University | Lulea University of Technology | ltu.se | www.ltu.se | - |
| University | University of Copenhagen | ku.dk | www.ku.dk | nbi.ku.dk, nbia.nbi.ku.dk |
| University | University of Oslo | uio.no | www.uio.no | www.mn.uio.no |
| University | University of Helsinki | helsinki.fi | www.helsinki.fi | www.physics.helsinki.fi |
| University | Aalto University | aalto.fi | www.aalto.fi | physics.aalto.fi, users.aalto.fi |
| University | Technical University of Denmark | dtu.dk | www.dtu.dk | physics.dtu.dk |
| University | University of Oxford | ox.ac.uk | www.ox.ac.uk | www.physics.ox.ac.uk, www.maths.ox.ac.uk, people.maths.ox.ac.uk, courses.maths.ox.ac.uk |
| University | University of Cambridge | cam.ac.uk | www.cam.ac.uk | www.phy.cam.ac.uk, www.damtp.cam.ac.uk, www.tcm.phy.cam.ac.uk, www.maths.cam.ac.uk |
| University | ETH Zurich | ethz.ch | www.ethz.ch | phys.ethz.ch, www.phys.ethz.ch, itp.phys.ethz.ch, www.itp.phys.ethz.ch, edu.itp.phys.ethz.ch, people.phys.ethz.ch |
| University | EPFL | epfl.ch | www.epfl.ch | infoscience.epfl.ch |
| University | Imperial College London | imperial.ac.uk | www.imperial.ac.uk | wwwf.imperial.ac.uk |
| University | University of Edinburgh | ed.ac.uk | www.ed.ac.uk | www.ph.ed.ac.uk, www2.ph.ed.ac.uk, www.maths.ed.ac.uk, maths.ed.ac.uk |
| University | Technical University of Munich | tum.de | www.tum.de | www.ph.nat.tum.de, www.nat.tum.de |
| University | MIT | mit.edu | www.mit.edu | physics.mit.edu, math.mit.edu, web.mit.edu |
| University | Harvard University | harvard.edu | www.harvard.edu | physics.harvard.edu, www.math.harvard.edu, scholar.harvard.edu, people.fas.harvard.edu |
| University | Stanford University | stanford.edu | www.stanford.edu | physics.stanford.edu, math.stanford.edu, mathematics.stanford.edu, sitp.stanford.edu, web.stanford.edu |
| University | Princeton University | princeton.edu | www.princeton.edu | phy.princeton.edu, www.math.princeton.edu, web.math.princeton.edu, pcts.princeton.edu |
| University | Cornell University | cornell.edu | www.cornell.edu | physics.cornell.edu, www.lassp.cornell.edu, sethna.lassp.cornell.edu, math.cornell.edu |
| University | UC Berkeley | berkeley.edu | www.berkeley.edu | physics.berkeley.edu, math.berkeley.edu, bctp.berkeley.edu |
| University | Caltech | caltech.edu | www.caltech.edu | pma.caltech.edu, www.theory.caltech.edu, theory.caltech.edu |
| University | UC Santa Barbara | ucsb.edu | www.ucsb.edu | www.physics.ucsb.edu, physics.ucsb.edu |
| Development | GitHub | github.com | www.github.com | - |
| Development | GitLab | gitlab.com | - | about.gitlab.com |
| Development | Bitbucket | bitbucket.org | - | - |
| Development | Stack Overflow | stackoverflow.com | - | - |
| Development | MDN | developer.mozilla.org | - | - |
| Development | Python documentation | docs.python.org | - | - |
| Development | PyPI | pypi.org | - | - |
| Development | npm | npmjs.com | www.npmjs.com | - |
| Development | Node.js | nodejs.org | - | - |
| Physics institutes | Nordita | nordita.org | www.nordita.org | - |
| Physics institutes | Perimeter Institute | perimeterinstitute.ca | www.perimeterinstitute.ca | - |
| Physics institutes | KITP | kitp.ucsb.edu | www.kitp.ucsb.edu | online.kitp.ucsb.edu |
| Physics institutes | ICTP | ictp.it | www.ictp.it | indico.ictp.it |
| Physics institutes | CERN | home.cern | - | cern.ch, www.cern.ch, th-dep.web.cern.ch, indico.cern.ch, cds.cern.ch |
| Physics institutes | DESY | desy.de | www.desy.de | theory-hamburg.desy.de, indico.desy.de |
| Physics institutes | Institute for Advanced Study | ias.edu | www.ias.edu | video.ias.edu |
| Physics institutes | SISSA | sissa.it | www.sissa.it | people.sissa.it |
| Physics institutes | Max Planck Complex Systems | www.pks.mpg.de | - | - |
| Physics institutes | Max Planck Solid State Research | www.fkf.mpg.de | - | - |
| Physics institutes | Isaac Newton Institute | newton.ac.uk | www.newton.ac.uk | - |
| Learning | MIT OpenCourseWare | ocw.mit.edu | - | - |
| Learning | Perimeter lecture archive | pirsa.org | - | - |
| Learning | Coursera | coursera.org | www.coursera.org | - |
| Learning | edX | edx.org | www.edx.org | learning.edx.org, home.edx.org |
| Learning | Feynman Lectures | www.feynmanlectures.caltech.edu | - | - |
| Learning | NumPy | numpy.org | - | - |
| Learning | SciPy | scipy.org | - | docs.scipy.org |
| Learning | Julia | julialang.org | - | docs.julialang.org |
| Learning | DLMF | dlmf.nist.gov | - | - |
| Learning | Netlib | netlib.org | www.netlib.org | - |
| Learning | Chebfun | chebfun.org | www.chebfun.org | - |
| Cloud storage | Google Drive | drive.google.com | - | - |
| Cloud storage | OneDrive | onedrive.live.com | - | onedrive.cloud.microsoft |
| Cloud storage | Dropbox | dropbox.com | www.dropbox.com | - |
| Cloud storage | Box | app.box.com | - | - |
| Productivity | Google Docs, Sheets, Slides and Forms | docs.google.com | - | - |
| Productivity | Google Calendar | calendar.google.com | - | - |
| Productivity | Google Keep | keep.google.com | - | - |
| Productivity | Microsoft web documents | word.cloud.microsoft | - | excel.cloud.microsoft, powerpoint.cloud.microsoft |
| Productivity | Notion | notion.so | www.notion.so | notion.com, www.notion.com |
| Productivity | Trello | trello.com | - | - |
| Productivity | Figma | figma.com | www.figma.com | - |
| Communication | Google Meet | meet.google.com | - | workspace.google.com |
| Communication | Microsoft Teams | teams.microsoft.com | - | teams.cloud.microsoft |
| Communication | Slack | slack.com | - | app.slack.com |
| Communication | Zoom | zoom.us | www.zoom.us | app.zoom.us, www.zoom.com |
| Utilities | Google Translate | translate.google.com | - | - |
| Utilities | DeepL | deepl.com | www.deepl.com | - |
| Utilities | Mozilla Support | support.mozilla.org | - | - |
| Utilities | Google Support | support.google.com | - | - |
| Utilities | Microsoft Support | support.microsoft.com | - | - |
