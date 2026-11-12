import { categoryIcons } from '../ui/category-icons.js';
import { normalizeTarget } from '@atlas/core';
import { validBookmarkPage } from '../ui/home-bookmarks.js';
/** Read-only projection. Native folder contents are never synchronization targets. */
export function toolbarFolders(root) {
    const folders = [], observed = new Set();
    let visited = 0, pages = 0, truncated = false;
    function walk(node, into, prefix, depth) {
        if (++visited > 10000 || depth > 16 || pages >= 2000 || into.length >= 200) {
            truncated = true;
            return;
        }
        observed.add(node.id);
        if (node.type === 'separator')
            return;
        if (node.url) {
            const label = (prefix + (node.title.trim() || normalizeTarget(node.url)?.hostname || 'Bookmark')).slice(0, 100);
            const page = { id: `firefox:${node.id.replaceAll('_', '.')}`, label, url: node.url };
            if (validBookmarkPage(page)) {
                into.push(page);
                pages++;
            }
        }
        else
            for (const child of node.children ?? [])
                walk(child, into, `${prefix}${node.title.trim()} / `, depth + 1);
    }
    for (const node of root.children ?? []) {
        if (node.url || node.type === 'separator')
            continue;
        if (folders.length >= 200) {
            truncated = true;
            break;
        }
        observed.add(node.id);
        const folder = { id: node.id, label: node.title.trim().slice(0, 100) || 'Folder', pages: [] };
        for (const child of node.children ?? [])
            walk(child, folder.pages, '', 0);
        folders.push(folder);
    }
    return { folders, observed, truncated };
}
/** Independent record: older builds continue reading their unchanged sync record. */
export function readToolbarIcons(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 200)
        return null;
    if (!Object.entries(input).every(([id, value]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id) && categoryIcons.includes(value)))
        return null;
    return structuredClone(input);
}
