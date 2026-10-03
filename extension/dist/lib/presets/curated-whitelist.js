import { normalizeTarget } from '@atlas/core';
/** Initial product preset. Edit services here; generated Policy remains exact-host only. */
export const curatedWhitelist = [
    { label: 'AI', services: [
            { label: 'ChatGPT', hostname: 'chatgpt.com' },
            { label: 'Claude', hostname: 'claude.ai' },
        ] },
    { label: 'Mail', services: [
            { label: 'Gmail', hostname: 'mail.google.com' },
            { label: 'KTH Mail', hostname: 'webmail.kth.se' },
            { label: 'Outlook', hostname: 'outlook.com', aliases: ['www.outlook.com'],
                destinations: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'] },
            { label: 'Microsoft 365', hostname: 'microsoft365.com', aliases: ['www.microsoft365.com'] },
        ] },
    { label: 'Video', services: [
            { label: 'YouTube', hostname: 'youtube.com', aliases: ['www.youtube.com'] },
        ] },
    { label: 'Scholar / Research', services: [
            { label: 'Google Scholar', hostname: 'scholar.google.com' },
            { label: 'arXiv', hostname: 'arxiv.org' },
            { label: 'INSPIRE', hostname: 'inspirehep.net' },
            { label: 'DOI', hostname: 'doi.org' },
            { label: 'Crossref', hostname: 'crossref.org' },
            { label: 'ORCID', hostname: 'orcid.org' },
            { label: 'Semantic Scholar', hostname: 'semanticscholar.org', aliases: ['www.semanticscholar.org'] },
            { label: 'APS', hostname: 'journals.aps.org', destinations: ['link.aps.org'] },
            { label: 'AIP', hostname: 'pubs.aip.org' },
            { label: 'IOPscience', hostname: 'iopscience.iop.org' },
            { label: 'Nature', hostname: 'nature.com', aliases: ['www.nature.com'] },
            { label: 'Science', hostname: 'science.org', aliases: ['www.science.org'] },
            { label: 'ScienceDirect', hostname: 'sciencedirect.com', aliases: ['www.sciencedirect.com'] },
            { label: 'Springer', hostname: 'springer.com', destinations: ['link.springer.com'] },
            { label: 'Wiley Online Library', hostname: 'onlinelibrary.wiley.com' },
            { label: 'Oxford Academic', hostname: 'academic.oup.com' },
            { label: 'Cambridge', hostname: 'cambridge.org', aliases: ['www.cambridge.org'] },
            { label: 'JSTOR', hostname: 'jstor.org', aliases: ['www.jstor.org'] },
            { label: 'IEEE Xplore', hostname: 'ieeexplore.ieee.org' },
            { label: 'ACM Digital Library', hostname: 'dl.acm.org' },
            { label: 'PubMed / NCBI', hostname: 'pubmed.ncbi.nlm.nih.gov', destinations: ['ncbi.nlm.nih.gov'] },
        ] },
    { label: 'Writing', services: [
            { label: 'Overleaf', hostname: 'overleaf.com', aliases: ['www.overleaf.com'] },
        ] },
    { label: 'University', services: [
            { label: 'Ladok', hostname: 'student.ladok.se' },
            { label: 'Canvas', hostname: 'canvas.kth.se', destinations: ['canvas.instructure.com', 'learn.canvas.net'] },
        ] },
    { label: 'Development', services: [
            { label: 'GitHub', hostname: 'github.com', aliases: ['www.github.com'] },
        ] },
];
export function serviceHostnames(service) {
    return [service.hostname, ...(service.aliases ?? []), ...(service.destinations ?? [])];
}
/** Display metadata only; never makes a hostname available or equivalent. */
export function serviceLabel(hostname) {
    for (const group of curatedWhitelist)
        for (const service of group.services) {
            if (serviceHostnames(service).includes(hostname))
                return service.label;
        }
    return hostname;
}
export function compileCuratedWhitelist(groups = curatedWhitelist) {
    const hostnames = new Set();
    for (const group of groups)
        for (const service of group.services)
            for (const hostname of serviceHostnames(service)) {
                if (normalizeTarget({ hostname })?.hostname !== hostname)
                    throw new TypeError('Invalid curated hostname');
                hostnames.add(hostname);
            }
    return { whitelist: [...hostnames], blacklist: [] };
}
