import { toolbarFolders, readToolbarIcons } from './toolbar-folders.js';
import { categoryIcons } from '../ui/category-icons.js';
import { normalizeTarget } from '@atlas/core';
import { openBookmarkRepository, openRecord, homeLayoutDatabase } from '../ui/home-layout-storage.js';
import { readHomeBookmarks, defaultBookmarkPages } from '../ui/home-bookmarks.js';
import { readPins, updateDestinationPin } from '../ui/home-model.js';
import { readDestinationPreferences, validDestinationId } from '../ui/destination-metadata.js';
import { curatedServiceCatalog, serviceHostnames } from '../presets/curated-whitelist.js';
import { presentationCommands, emptySync, readSync, same, validGroups, mergeGroups } from './model.js';
const pinsKey = 'atlas-home-pins-v1', metadataKey = 'atlas-destinations-v1';
function fail(code) { throw new Error(code); }
const fields = (n) => ({ parentId: n.parentId ?? '', title: n.title, url: n.url ?? null, index: n.index ?? 0 });
const supported = (n) => !!n.url && /^https?:\/\//i.test(n.url) && n.url.length <= 4096 && normalizeTarget(n.url) !== null && n.title.length <= 100;
const keys = (v) => Object.keys(v).sort().join(',');
// Firefox GUIDs include underscores; Atlas page IDs intentionally do not.
// Native GUIDs contain no dots, so this mapping is stable and collision-free.
const nativePageId = (id) => `firefox:${id.replaceAll('_', '.')}`;
/** Presentation-only single writer. No reference to a controller or authorization API. */
export class BookmarkSyncOwner {
    api;
    storage;
    factory;
    id;
    chain = Promise.resolve();
    store = null;
    bookmarks = null;
    state = emptySync();
    revision = 0;
    preview = null;
    listening = false;
    disposed = false;
    eventPending = false;
    listeningEvents = [];
    warnings = [];
    folders = [];
    iconStore = null;
    folderIcons = { revision: 0, value: null };
    folderNodes = new Set();
    toolbarOrder = [];
    comparison = null;
    constructor(api, storage, factory = indexedDB, id = () => crypto.randomUUID()) {
        this.api = api;
        this.storage = storage;
        this.factory = factory;
        this.id = id;
    }
    run(work) {
        const result = this.chain.then(async () => { await this.load(); return work(); });
        this.chain = result.catch(() => undefined);
        return result;
    }
    async start() {
        this.api.runtime.onMessage.addListener(this.message);
        this.api.permissions.onAdded.addListener(this.permissionChanged);
        this.api.permissions.onRemoved.addListener(this.permissionChanged);
        await this.run(async () => {
            await this.listeners();
            await this.autoConnect();
            await this.sync();
        }).catch(() => undefined);
    }
    async autoConnect() {
        if (this.api.runtime.getManifest?.().permissions?.includes('bookmarks') && await this.allowed() && !(!this.state.enabled && this.state.root !== null) && !['CONFLICT', 'DUPLICATE', 'UNSUPPORTED', 'STORAGE'].includes(this.state.issue) && !this.state.pending && !this.state.conflictRemote && (!this.state.enabled || this.state.scope !== 'toolbar')) {
            await this.connectToolbar().catch(e => this.issue(e));
        }
    }
    async load() {
        this.store ??= await openRecord(this.factory, homeLayoutDatabase, 'firefox-sync-v1', readSync);
        this.bookmarks ??= await openBookmarkRepository(this.factory);
        const e = await this.store.load();
        this.revision = e.revision;
        this.state = e.value ?? emptySync();
        this.iconStore ??= await openRecord(this.factory, homeLayoutDatabase, 'toolbar-folder-icons-v1', readToolbarIcons);
        this.folderIcons = await this.iconStore.load();
    }
    async save() {
        const r = await this.store.save(this.revision, this.state);
        if (r.type !== 'SAVED')
            fail(r.type === 'CONFLICT' ? 'CONFLICT' : 'STORAGE');
        this.revision = r.envelope.revision;
    }
    pins() {
        const raw = JSON.parse(this.storage.getItem(pinsKey) ?? '[]');
        const pins = readPins(raw);
        if (!Array.isArray(raw) || !same(raw, pins))
            fail('STORAGE');
        return [...pins];
    }
    writePins(pins) {
        if (!same(readPins(pins), pins))
            fail('STORAGE');
        this.storage.setItem(pinsKey, JSON.stringify(pins));
        if (!same(this.pins(), pins))
            fail('STORAGE');
    }
    metadata() { return readDestinationPreferences(JSON.parse(this.storage.getItem(metadataKey) ?? 'null')).destinations; }
    identify(hostname) {
        const metadata = this.metadata().find(m => m.hostnames.includes(hostname));
        if (metadata)
            return { id: metadata.id, label: metadata.label, hostname: metadata.primaryHostname };
        for (const category of curatedServiceCatalog)
            for (const s of category.services)
                if (serviceHostnames(s).includes(hostname))
                    return { id: `service:${s.hostname}`, label: s.label, hostname: s.hostname };
        return { id: `host:${hostname}`, label: hostname, hostname };
    }
    descriptor(id) {
        const old = this.state.groups.find(g => g.id === id), host = id.replace(/^(service|host):/, '');
        const known = this.metadata().find(m => m.id === id);
        const info = known ? { id, label: known.label, hostname: known.primaryHostname } : { ...this.identify(host), id };
        return { ...info, label: this.state.metadataLabels[id] !== undefined && this.state.metadataLabels[id] !== info.label ? info.label : this.state.labels[id] ?? old?.label ?? info.label };
    }
    defaults(id) {
        const info = this.descriptor(id), metadata = this.metadata().find(m => m.id === id);
        const service = curatedServiceCatalog.flatMap(c => c.services).find(s => `service:${s.hostname}` === id);
        return defaultBookmarkPages({ ...info, hostnames: metadata?.hostnames ?? (service ? serviceHostnames(service) : [info.hostname]), category: 'Bookmarks' });
    }
    async local() {
        const pins = this.pins(), saved = await this.bookmarks.load();
        const ids = [...new Set([...pins, ...this.state.groups.map(g => g.id)])];
        return ids.map(id => {
            const info = this.descriptor(id), old = this.state.groups.find(g => g.id === id);
            const override = saved.value?.groups.find(g => g.parentId === id);
            const pages = override?.pages ?? (old?.pages.length === 0 ? [] : this.defaults(id));
            return { ...info, pinned: pins.includes(id), pages: structuredClone([...pages]) };
        });
    }
    async node(id) { try {
        return (await this.api.bookmarks.get(id))[0] ?? null;
    }
    catch {
        return null;
    } }
    async native(root) {
        if (!root)
            return { groups: [], bindings: [], warnings: [] };
        const tree = (await this.api.bookmarks.getSubTree(root).catch(() => []))[0];
        if (!tree || tree.url)
            fail('ROOT_MISSING');
        if (this.state.scope === 'toolbar')
            return this.toolbarNative(tree);
        const groups = [], bindings = [], warnings = [];
        const direct = [];
        for (const n of tree.children ?? []) {
            if (n.url) {
                if (supported(n))
                    direct.push(n);
                else
                    warnings.push('Unsupported bookmark kept in Firefox.');
                continue;
            }
            if (n.type === 'separator') {
                warnings.push('Separator kept in Firefox.');
                continue;
            }
            const mapped = this.state.bindings.find(b => b.folder === n.id), old = this.state.groups.find(g => g.id === mapped?.id);
            if (n.title.length > 100) {
                if (mapped)
                    fail('UNSUPPORTED');
                warnings.push('Folder name exceeds 100 characters; kept in Firefox only.');
                continue;
            }
            const children = n.children ?? [];
            const pages = children.filter(supported);
            if (children.some(c => !supported(c)))
                warnings.push('Nested folders or unsupported bookmarks kept in Firefox.');
            if (!pages.length && !old) {
                warnings.push('Empty folder kept in Firefox.');
                continue;
            }
            const info = old ?? this.identify(normalizeTarget(pages[0].url).hostname);
            if (groups.some(g => g.id === info.id))
                fail('DUPLICATE');
            const pageIds = {};
            const values = pages.map(p => {
                const pid = Object.keys(mapped?.pages ?? {}).find(k => mapped.pages[k] === p.id) ?? nativePageId(p.id);
                pageIds[pid] = p.id;
                return { id: pid, label: p.title.trim() || normalizeTarget(p.url).hostname, url: p.url };
            });
            groups.push({ id: info.id, hostname: info.hostname, label: n.title.trim().slice(0, 100) || info.label, pinned: values.length > 0, pages: values });
            bindings.push({ id: info.id, folder: n.id, pages: pageIds });
        }
        for (const n of direct) {
            const info = this.identify(normalizeTarget(n.url).hostname);
            let group = groups.find(g => g.id === info.id);
            if (!group) {
                const previous = this.state.groups.find(g => g.id === info.id);
                group = { ...info, pinned: true, pages: structuredClone(previous?.pages ?? []) };
                groups.push(group);
            }
            const oldBinding = this.state.bindings.find(b => b.id === info.id);
            const pid = Object.keys(oldBinding?.pages ?? {}).find(k => oldBinding.pages[k] === n.id) ?? nativePageId(n.id);
            group.pages.push({ id: pid, label: n.title.trim() || info.label, url: n.url });
            let binding = bindings.find(b => b.id === info.id);
            // Direct bookmarks are moved only after an acknowledged sync intent. Their IDs remain stable.
            if (!binding) {
                binding = { id: info.id, folder: oldBinding?.folder ?? root, pages: { ...oldBinding?.pages } };
                bindings.push(binding);
            }
            binding.pages[pid] = n.id;
        }
        for (const old of this.state.groups)
            if (!groups.some(g => g.id === old.id)) {
                groups.push({ ...structuredClone(old), pinned: false });
                const b = this.state.bindings.find(b => b.id === old.id);
                if (b)
                    bindings.push(structuredClone(b));
            }
        if (!validGroups(groups))
            fail('UNSUPPORTED');
        return { groups, bindings, warnings };
    }
    toolbarNative(tree) {
        const groups = [], bindings = [], warnings = [];
        const projected = toolbarFolders(tree);
        this.folders = projected.folders;
        this.folderNodes = projected.observed;
        this.toolbarOrder = [];
        if (projected.truncated)
            warnings.push('Some folder contents exceed the supported display limit. They remain in Firefox.');
        for (const n of tree.children ?? []) {
            if (!n.url) {
                if (n.type !== 'separator')
                    this.toolbarOrder.push(`folder:${n.id}`);
                continue;
            } // Folders are mirrored read-only.
            if (!supported(n)) {
                warnings.push('Unsupported toolbar bookmark kept in Firefox.');
                continue;
            }
            const mapped = this.state.bindings.find(b => b.folder === tree.id && Object.values(b.pages).includes(n.id));
            const old = this.state.groups.find(g => g.id === mapped?.id) ?? this.state.pending?.target.find(g => g.id === mapped?.id);
            const info = old ?? this.identify(normalizeTarget(n.url).hostname);
            if (!this.toolbarOrder.includes(info.id))
                this.toolbarOrder.push(info.id);
            let g = groups.find(g => g.id === info.id), b = bindings.find(b => b.id === info.id);
            if (!g) {
                g = { id: info.id, hostname: info.hostname, label: info.label, pinned: true, pages: [] };
                groups.push(g);
                b = { id: info.id, folder: tree.id, pages: {} };
                bindings.push(b);
            }
            const pid = Object.keys(mapped?.pages ?? {}).find(p => mapped.pages[p] === n.id) ?? nativePageId(n.id);
            g.pages.push({ id: pid, label: n.title.trim() || info.label, url: n.url });
            b.pages[pid] = n.id;
        }
        for (const g of groups)
            g.label = g.pages.length === 1 ? g.pages[0].label
                : this.state.pending?.target.find(t => t.id === g.id)?.label ?? this.state.labels[g.id] ?? g.label;
        for (const old of this.state.groups)
            if (!groups.some(g => g.id === old.id)) {
                groups.push({ ...structuredClone(old), pinned: false });
                const b = this.state.bindings.find(b => b.id === old.id && b.folder === tree.id);
                if (b)
                    bindings.push(structuredClone(b));
            }
        if (!validGroups(groups))
            fail('UNSUPPORTED');
        return { groups, bindings, warnings };
    }
    async allowed() { return this.api.permissions.contains({ permissions: ['bookmarks'] }); }
    async listeners() {
        const allow = await this.allowed();
        if (allow === this.listening)
            return;
        if (allow) {
            if (!this.api.bookmarks)
                fail('PERMISSION');
            this.listeningEvents = [this.api.bookmarks.onCreated, this.api.bookmarks.onChanged, this.api.bookmarks.onMoved, this.api.bookmarks.onRemoved];
            for (const event of this.listeningEvents)
                event.addListener(this.changed);
        }
        else {
            for (const event of this.listeningEvents)
                event.removeListener(this.changed);
            this.listeningEvents = [];
        }
        this.listening = allow;
    }
    permissionChanged = () => { void this.run(async () => { await this.listeners(); await this.autoConnect(); await this.sync(); }).catch(() => undefined); };
    changed = (id, info) => {
        if (this.disposed || !this.state.enabled)
            return;
        const m = this.state.mutation, pending = this.state.pending, change = info;
        // Firefox has no conditional update primitive. Keep an overlapping observed
        // edit, even if our in-flight API call wins the native race, for explicit review.
        if (m && pending && m.id === id && !('parentId' in info) && (typeof change.title === 'string' && change.title !== m.title || typeof change.url === 'string' && change.url !== m.url)) {
            const binding = this.state.bindings.find(b => b.folder === id || Object.values(b.pages).includes(id));
            if (binding) {
                const remote = structuredClone(this.state.conflictRemote ?? pending.nativeBefore), g = remote.find(g => g.id === binding.id);
                if (g) {
                    if (binding.folder === id && change.title !== undefined)
                        g.label = change.title;
                    else {
                        const page = Object.keys(binding.pages).find(p => binding.pages[p] === id);
                        g.pages = g.pages.map(p => p.id === page ? { ...p, ...(change.title === undefined ? {} : { label: change.title }), ...(change.url === undefined ? {} : { url: change.url }) } : p);
                    }
                    if (validGroups(remote))
                        this.state.conflictRemote = remote;
                    this.state.issue = 'CONFLICT';
                }
            }
        }
        if (this.eventPending)
            return;
        const i = info;
        const ids = new Set([this.state.root, ...this.folderNodes, ...this.state.bindings.flatMap(b => [b.folder, ...Object.values(b.pages)])]);
        if (!ids.has(id) && !ids.has(i.parentId ?? '') && !ids.has(i.oldParentId ?? ''))
            return;
        this.eventPending = true;
        void this.run(async () => { this.eventPending = false; await this.sync(); }).catch(() => { this.eventPending = false; });
    };
    async issue(error) {
        const code = error instanceof Error ? error.message : 'STORAGE';
        this.state.issue = ['CONFLICT', 'ROOT_MISSING', 'PERMISSION', 'UNSUPPORTED', 'DUPLICATE'].includes(code) ? code : 'STORAGE';
        await this.save().catch(() => undefined);
    }
    async mutation(m) {
        this.state.mutation = m;
        await this.save();
        return this.finishMutation();
    }
    async finishMutation() {
        const m = this.state.mutation;
        let result = m.id;
        if (m.kind === 'create') {
            const children = await this.api.bookmarks.getChildren(m.parentId);
            const possible = children.filter(n => !m.children.includes(n.id) && n.title === m.title && (n.url ?? null) === m.url);
            if (possible.length > 1)
                fail('CONFLICT');
            result = possible[0]?.id ?? (await this.api.bookmarks.create({ parentId: m.parentId, title: m.title, ...(m.url ? { url: m.url } : {}), ...(m.index !== null ? { index: m.index } : {}) })).id;
        }
        else {
            const n = await this.node(m.id);
            if (m.kind === 'remove') {
                if (n) {
                    if (!same(fields(n), m.before))
                        fail('CONFLICT');
                    await this.api.bookmarks.remove(n.id);
                }
            }
            else {
                if (!n)
                    fail('CONFLICT');
                const done = m.kind === 'move' ? n.parentId === m.parentId && (m.index === null || n.index === m.index) : n.title === m.title && (n.url ?? null) === m.url;
                if (!done) {
                    if (!same(fields(n), m.before))
                        fail('CONFLICT');
                    if (m.kind === 'move')
                        await this.api.bookmarks.move(n.id, { parentId: m.parentId, ...(m.index !== null ? { index: m.index } : {}) });
                    else
                        await this.api.bookmarks.update(n.id, { title: m.title, ...(m.url ? { url: m.url } : {}) });
                }
            }
        }
        if (m.result === 'root')
            this.state.root = result;
        else if (m.result === 'archive')
            this.state.archive = result;
        else if (m.result && result) {
            const binding = m.result;
            let b = this.state.bindings.find(b => b.id === binding.group);
            if (!b) {
                b = { id: m.result.group, folder: this.state.root, pages: {} };
                this.state.bindings.push(b);
            }
            if (m.result.page === null)
                b.folder = result;
            else
                b.pages[m.result.page] = result;
        }
        this.state.mutation = null;
        await this.save();
        if (this.state.issue === 'CONFLICT')
            fail('CONFLICT');
        return result;
    }
    async create(parentId, title, url, result) {
        return (await this.mutation({ kind: 'create', id: null, parentId, title, url, index: null, before: null, children: (await this.api.bookmarks.getChildren(parentId)).map(n => n.id), result }));
    }
    async move(n, parentId, index = null) {
        if (n.parentId === parentId && (index === null || n.index === index))
            return;
        await this.mutation({ kind: 'move', id: n.id, parentId, index, title: null, url: null, before: fields(n), children: [], result: null });
    }
    async update(n, title, url) {
        if (n.title === title && (n.url ?? null) === url)
            return;
        await this.mutation({ kind: 'update', id: n.id, title, url, parentId: null, index: null, before: fields(n), children: [], result: null });
    }
    async applyNative(target) {
        if (this.state.mutation)
            await this.finishMutation();
        if (this.state.scope === 'toolbar') {
            await this.applyToolbar(target);
            return;
        }
        if (!this.state.root)
            await this.create('toolbar_____', 'Atlas', null, 'root');
        if (!await this.node(this.state.root))
            fail('ROOT_MISSING');
        let position = 0;
        for (const g of target) {
            const original = this.state.pending?.nativeBefore.find(item => item.id === g.id);
            let b = this.state.bindings.find(b => b.id === g.id), folder = b && b.folder !== this.state.root ? await this.node(b.folder) : null;
            if (!g.pinned) {
                if (folder?.parentId === this.state.root) {
                    if (!g.pages.length)
                        for (const [pid, nid] of Object.entries(b?.pages ?? {})) {
                            const n = await this.node(nid), before = original?.pages.find(p => p.id === pid);
                            if (n) {
                                if (n.parentId !== folder.id || !before || n.title !== before.label || n.url !== before.url)
                                    fail('CONFLICT');
                                await this.mutation({ kind: 'remove', id: nid, parentId: null, title: null, url: null, index: null, before: fields(n), children: [], result: null });
                            }
                            delete b.pages[pid];
                            await this.save();
                        }
                    if (!this.state.archive || !await this.node(this.state.archive))
                        await this.create('toolbar_____', 'Atlas — Unpinned', null, 'archive');
                    await this.move(folder, this.state.archive);
                }
                continue;
            }
            if (!g.pages.length)
                fail('CONFLICT');
            if (!folder) {
                await this.create(this.state.root, g.label, null, { group: g.id, page: null });
                b = this.state.bindings.find(b => b.id === g.id);
                folder = await this.node(b.folder);
            }
            if (!folder || !b)
                fail('CONFLICT');
            if (folder.title !== g.label && folder.title !== original?.label)
                fail('CONFLICT');
            if (original?.pinned && folder.parentId !== this.state.root)
                fail('CONFLICT');
            await this.move(folder, this.state.root, position++);
            folder = (await this.node(folder.id));
            await this.update(folder, g.label, null);
            let index = 0;
            for (const p of g.pages) {
                let n = b.pages[p.id] ? await this.node(b.pages[p.id]) : null;
                if (!n) {
                    await this.create(folder.id, p.label, p.url, { group: g.id, page: p.id });
                    n = await this.node(b.pages[p.id]);
                }
                if (!n)
                    fail('CONFLICT');
                const before = original?.pages.find(page => page.id === p.id);
                if (!(n.title === p.label && n.url === p.url) && !(n.title === before?.label && n.url === before?.url))
                    fail('CONFLICT');
                if (n.parentId !== folder.id && n.parentId !== this.state.root)
                    fail('CONFLICT');
                await this.move(n, folder.id, index++);
                n = (await this.node(n.id));
                await this.update(n, p.label, p.url);
            }
            for (const [pid, nid] of Object.entries(b.pages))
                if (!g.pages.some(p => p.id === pid)) {
                    const n = await this.node(nid);
                    const before = original?.pages.find(page => page.id === pid);
                    if (n && (!before || n.title !== before.label || n.url !== before.url))
                        fail('CONFLICT');
                    if (n && n.parentId === folder.id)
                        await this.mutation({ kind: 'remove', id: nid, parentId: null, title: null, url: null, index: null, before: fields(n), children: [], result: null });
                    delete b.pages[pid];
                    await this.save();
                }
        }
    }
    async applyToolbar(target) {
        const root = this.state.root;
        if (!await this.node(root))
            fail('ROOT_MISSING');
        const wanted = [];
        for (const g of target) {
            let b = this.state.bindings.find(b => b.id === g.id);
            if (!b) {
                b = { id: g.id, folder: root, pages: {} };
                this.state.bindings.push(b);
            }
            const original = this.state.pending?.nativeBefore.find(old => old.id === g.id);
            // The page model requires a readable title; Firefox permits an empty one.
            // Compare its same display projection, then journal the exact native fields.
            const matches = (n, p) => !!p && n.url === p.url
                && (n.title.trim() === p.label || !n.title.trim() && (p.label === original?.label || p.label === g.label));
            for (const [pid, nid] of Object.entries(b.pages))
                if (!g.pinned || !g.pages.some(p => p.id === pid)) {
                    const n = await this.node(nid), before = original?.pages.find(p => p.id === pid);
                    // A bookmark moved out of the toolbar belongs to Firefox again.
                    if (n?.parentId === root) {
                        if (!matches(n, before))
                            fail('CONFLICT');
                        await this.mutation({ kind: 'remove', id: nid, parentId: null, title: null, url: null, index: null, before: fields(n), children: [], result: null });
                    }
                    delete b.pages[pid];
                    await this.save();
                }
            if (!g.pinned)
                continue;
            for (const p of g.pages) {
                let n = b.pages[p.id] ? await this.node(b.pages[p.id]) : null;
                if (!n) {
                    await this.create(root, p.label, p.url, { group: g.id, page: p.id });
                    n = await this.node(b.pages[p.id]);
                }
                if (!n || n.parentId !== root)
                    fail('CONFLICT');
                const before = original?.pages.find(old => old.id === p.id);
                if (!matches(n, p) && !matches(n, before))
                    fail('CONFLICT');
                await this.update(n, p.label, p.url);
                wanted.push(n.id);
            }
        }
        // Replace only participating bookmark slots. Never issue mutations for a
        // folder, separator, unsupported bookmark or node outside the toolbar.
        const children = await this.api.bookmarks.getChildren(root), ids = new Set(wanted);
        const slots = children.filter(n => ids.has(n.id)).map(n => n.index);
        for (const [i, id] of wanted.entries()) {
            const n = await this.node(id);
            if (!n || n.parentId !== root)
                fail('CONFLICT');
            await this.move(n, root, slots[i]);
        }
    }
    candidateBookmarks(before, target) {
        return { version: 1, groups: [...(before?.groups ?? []).filter(g => !target.some(t => t.id === g.parentId)),
                ...target.filter(g => g.pages.length).map(g => ({ parentId: g.id, pages: g.pages }))] };
    }
    async complete() {
        const pending = this.state.pending;
        await this.applyNative(pending.target);
        // A browser edit may have arrived during an awaited native operation. It must
        // not be published as if the requested image was still the browser's image.
        const actual = await this.native(this.state.root);
        const expected = pending.target.filter(g => g.pinned), observed = actual.groups.filter(g => g.pinned);
        if (!same(expected, observed))
            fail('CONFLICT');
        const current = await this.bookmarks.load(), value = pending.bookmarksCandidate;
        if (!same(current.value, value)) {
            if (current.revision !== pending.bookmarkRevision)
                fail('CONFLICT');
            const result = await this.bookmarks.save(current.revision, value);
            if (result.type !== 'SAVED')
                fail(result.type === 'CONFLICT' ? 'CONFLICT' : 'STORAGE');
        }
        const pins = pending.target.filter(g => g.pinned).map(g => g.id);
        if (!same(this.pins(), pins)) {
            if (!same(this.pins(), pending.pinsBefore))
                fail('CONFLICT');
            this.writePins(pins);
        }
        this.state.groups = structuredClone(pending.target);
        for (const g of pending.target) {
            this.state.labels[g.id] = g.label;
            this.state.metadataLabels[g.id] = this.metadata().find(m => m.id === g.id)?.label ?? this.identify(g.hostname).label;
        }
        this.state.pending = null;
        this.state.issue = 'NONE';
        await this.save();
    }
    async synchronize(target, bindings, bookmarksInput) {
        if (this.state.scope === 'toolbar')
            target = target.map(g => g.pages.length === 1 ? { ...g, label: g.pages[0].label } : g);
        if (!validGroups(target))
            fail('UNSUPPORTED');
        const saved = await this.bookmarks.load();
        this.state.bindings = bindings;
        this.state.pending = { target, nativeBefore: (await this.native(this.state.root)).groups, pinsBefore: this.pins(), bookmarkRevision: saved.revision, bookmarksCandidate: this.candidateBookmarks(bookmarksInput ?? saved.value, target) };
        await this.save();
        await this.complete();
    }
    async sync(emptied = []) {
        if (!this.state.enabled)
            return;
        try {
            if (!await this.allowed())
                fail('PERMISSION');
            if (this.state.pending) {
                if (this.state.issue === 'CONFLICT')
                    return;
                await this.complete();
                return;
            }
            if (['ROOT_MISSING', 'CONFLICT', 'DUPLICATE'].includes(this.state.issue))
                return;
            const local = (await this.local()).map(g => emptied.includes(g.id) ? { ...g, pages: [], pinned: false } : g), remote = await this.native(this.state.root);
            this.warnings = remote.warnings;
            const merged = mergeGroups(this.state.groups, local, remote.groups);
            if (!merged)
                fail('CONFLICT');
            if (same(merged, this.state.groups) && same(remote.bindings, this.state.bindings)) {
                if (this.state.issue !== 'NONE') {
                    this.state.issue = 'NONE';
                    await this.save();
                }
                return;
            }
            await this.synchronize(merged, remote.bindings);
        }
        catch (e) {
            await this.issue(e);
        }
    }
    async response() {
        return { pins: this.pins(), bookmarks: await this.bookmarks.load(), sync: { revision: this.revision, enabled: this.state.enabled, scope: this.state.scope ?? 'folder', issue: this.state.issue, warnings: this.warnings,
                groups: this.state.groups.map(({ id, hostname, label, pinned }) => ({ id, hostname, label, pinned })), labels: this.state.labels, pending: !!this.state.pending, folders: this.state.enabled && this.state.scope === 'toolbar' ? this.folders : [], folderIcons: this.folderIcons.value ?? {}, toolbarOrder: this.toolbarOrder } };
    }
    async previewMerge(root) {
        if (!await this.allowed())
            fail('PERMISSION');
        const local = await this.local(), remote = await this.native(root), target = structuredClone(local), warnings = [...remote.warnings];
        for (const g of remote.groups) {
            const match = target.find(t => t.id === g.id);
            if (!match) {
                target.push(g);
                continue;
            }
            match.pinned ||= g.pinned;
            for (const p of g.pages)
                if (!match.pages.some(x => x.url === p.url && x.label === p.label)) {
                    match.pages.push(match.pages.some(x => x.id === p.id) ? { ...p, id: `merge:${this.id()}` } : p);
                }
                else
                    warnings.push('Identical page already present; one copy will be linked.');
        }
        if (!validGroups(target))
            fail('UNSUPPORTED');
        this.preview = { token: this.id(), root, local, remote: remote.groups, target, bindings: remote.bindings, warnings };
        return { preview: this.preview };
    }
    async connectToolbar() {
        if (!await this.allowed())
            fail('PERMISSION');
        if (this.state.pending || this.state.conflictRemote)
            return { error: 'SYNC_PENDING' };
        if (this.state.enabled && this.state.scope === 'toolbar') {
            await this.sync();
            return this.response();
        }
        const local = await this.local();
        this.state.scope = 'toolbar';
        this.state.root = 'toolbar_____';
        this.state.archive = null;
        this.state.bindings = [];
        this.state.groups = []; // Old folders remain untouched.
        const remote = await this.native(this.state.root), target = structuredClone(remote.groups);
        // Initial connection is additive, preserving native order, titles and IDs.
        // Existing exact URL matches are linked rather than exported a second time.
        for (const g of local)
            if (g.pinned) {
                const match = target.find(t => t.id === g.id);
                if (!match)
                    target.push(g);
                else
                    for (const p of g.pages)
                        if (!match.pages.some(x => x.url === p.url))
                            match.pages.push(p);
            }
        for (const g of target)
            if (g.pages.length === 1)
                g.label = g.pages[0].label;
        this.state.enabled = true;
        this.state.issue = 'NONE';
        this.warnings = remote.warnings;
        await this.listeners();
        await this.synchronize(target, remote.bindings);
        return this.response();
    }
    async dispatch(v) {
        if (v.kind === 'PRESENTATION_READ' && keys(v) === 'kind')
            return this.response();
        if (v.kind === 'SYNC_TOOLBAR' && keys(v) === 'kind') {
            return this.connectToolbar();
        }
        if (v.kind === 'FOLDER_ICON' && keys(v) === 'before,icon,id,kind' && typeof v.id === 'string' && typeof v.icon === 'string' && (v.icon === '' || categoryIcons.includes(v.icon))) {
            if (!this.folders.some(f => f.id === v.id))
                return { error: 'FOLDER_MISSING' };
            if ((this.folderIcons.value?.[v.id] ?? '') === v.icon)
                return this.response();
            if ((this.folderIcons.value?.[v.id] ?? '') !== v.before)
                return { error: 'CONFLICT' };
            const icons = { ...this.folderIcons.value };
            if (v.icon)
                icons[v.id] = v.icon;
            else
                delete icons[v.id];
            if (Object.keys(icons).length > 200)
                return { error: 'LIMIT' };
            const saved = await this.iconStore.save(this.folderIcons.revision, icons);
            if (saved.type !== 'SAVED')
                return { error: saved.type };
            this.folderIcons = saved.envelope;
            return this.response();
        }
        if (v.kind === 'BOOKMARK_SAVE' && keys(v) === 'kind,revision,value') {
            if (this.state.pending)
                return { type: 'FAILED' };
            const value = readHomeBookmarks(v.value);
            if (!value || !Number.isSafeInteger(v.revision))
                return { type: 'FAILED' };
            const before = await this.bookmarks.load();
            const emptied = (before.value?.groups ?? []).filter(g => !value.groups.some(n => n.parentId === g.parentId)).map(g => g.parentId);
            if (before.revision !== v.revision)
                return { type: 'CONFLICT', envelope: before };
            if (this.state.enabled && await this.allowed()) {
                if (this.state.issue !== 'NONE')
                    return { type: 'FAILED' };
                const local = await this.local(), remote = await this.native(this.state.root);
                for (const g of local) {
                    const pages = value.groups.find(p => p.parentId === g.id)?.pages;
                    if (emptied.includes(g.id)) {
                        g.pages = [];
                        g.pinned = false;
                    }
                    else if (pages)
                        g.pages = structuredClone([...pages]);
                }
                const merged = mergeGroups(this.state.groups, local, remote.groups);
                if (!merged)
                    fail('CONFLICT');
                // Intent precedes both copies. The editor is acknowledged only after the
                // journal has reconciled native changes and the local CAS has completed.
                await this.synchronize(merged, remote.bindings, value);
                const synced = await this.bookmarks.load();
                return { type: 'SAVED', envelope: synced };
            }
            return this.bookmarks.save(v.revision, value);
        }
        if (v.kind === 'PIN_SET' && keys(v) === 'hosts,id,kind,pinned' && validDestinationId(v.id) && typeof v.pinned === 'boolean'
            && Array.isArray(v.hosts) && v.hosts.length <= 100 && v.hosts.every(h => normalizeTarget({ hostname: h })?.hostname === h)) {
            if (this.state.pending)
                return { type: 'FAILED' };
            const pins = updateDestinationPin(this.pins(), v.id, v.pinned, v.hosts);
            if (pins.length > 200)
                return { type: 'FAILED' };
            this.writePins([...pins]);
            await this.sync();
            return { type: 'SAVED', ...await this.response() };
        }
        if (v.kind === 'SYNC_SETUP' && keys(v) === 'kind') {
            if (!await this.allowed())
                return { permission: false };
            const roots = await this.api.bookmarks.getTree(), folders = [];
            const walk = (n, path) => { if (n.url || n.type === 'separator' || folders.length >= 1000)
                return; const label = path ? `${path} / ${n.title}` : n.title; if (n.parentId)
                folders.push({ id: n.id, label }); for (const c of n.children ?? [])
                walk(c, label); };
            roots.forEach(n => walk(n, ''));
            return { permission: true, folders, ...await this.response() };
        }
        if (v.kind === 'SYNC_PREVIEW' && keys(v) === 'kind,root' && (v.root === null || typeof v.root === 'string'))
            return this.previewMerge(v.root);
        if (v.kind === 'SYNC_CONNECT' && keys(v) === 'kind,token' && this.preview?.token === v.token) {
            if (this.state.conflictRemote || this.state.pending && this.state.issue === 'CONFLICT')
                return { error: 'COMPARE_REQUIRED' };
            const p = this.preview;
            if (!same(p.local, await this.local()) || !same(p.remote, (await this.native(p.root)).groups))
                return { error: 'PREVIEW_CHANGED' };
            this.state.enabled = true;
            this.state.root = p.root;
            this.state.issue = 'NONE';
            await this.listeners();
            await this.synchronize(p.target, p.bindings);
            this.preview = null;
            return this.response();
        }
        if (v.kind === 'SYNC_DISABLE' && keys(v) === 'kind') {
            // Explicit disconnect stops even incomplete work. Keep both actual copies;
            // a later connection needs a fresh preview, not replay of abandoned intent.
            this.state.enabled = false;
            this.state.pending = null;
            this.state.mutation = null;
            this.state.conflictRemote = null;
            this.state.issue = 'NONE';
            await this.save();
            return this.response();
        }
        if (v.kind === 'PIN_ORDER' && keys(v) === 'before,kind,pins' && Array.isArray(v.pins) && same(readPins(v.pins), v.pins)) {
            if (this.state.pending)
                return { error: 'SYNC_PENDING' };
            const current = this.pins();
            if (!same(current, v.before) || !same([...current].sort(), [...v.pins].sort()))
                return { error: 'CONFLICT' };
            this.writePins(v.pins);
            await this.sync();
            return this.response();
        }
        if (v.kind === 'PIN_LABEL' && keys(v) === 'before,id,kind,label' && validDestinationId(v.id) && typeof v.label === 'string' && v.label.trim() && v.label.length <= 100) {
            if (this.state.pending)
                return { error: 'SYNC_PENDING' };
            if ((this.state.labels[v.id] ?? null) !== v.before)
                return { error: 'CONFLICT' };
            this.state.labels[v.id] = v.label.trim();
            await this.save();
            if (this.state.enabled && this.state.scope === 'toolbar' && await this.allowed()) {
                const local = await this.local(), g = local.find(g => g.id === v.id), remote = await this.native(this.state.root);
                if (g && g.pages.length === 1) {
                    g.pages = [{ ...g.pages[0], label: v.label.trim() }];
                    g.label = v.label.trim();
                }
                const merged = mergeGroups(this.state.groups, local, remote.groups);
                if (!merged)
                    fail('CONFLICT');
                await this.synchronize(merged, remote.bindings);
            }
            else
                await this.sync();
            return this.response();
        }
        if (v.kind === 'SYNC_RETRY' && keys(v) === 'kind') {
            if (this.state.issue === 'CONFLICT')
                return { error: 'COMPARE_REQUIRED' };
            this.state.issue = 'NONE';
            await this.save();
            await this.sync();
            return this.response();
        }
        if (v.kind === 'SYNC_COMPARE' && keys(v) === 'kind') {
            const observed = (await this.native(this.state.root)).groups;
            this.comparison = { token: this.id(), local: this.state.pending?.target ?? await this.local(), remote: this.state.conflictRemote ?? observed, observed };
            return { comparison: this.comparison };
        }
        if (v.kind === 'SYNC_RESOLVE' && keys(v) === 'kind,side,token' && typeof v.token === 'string' && ['ATLAS', 'FIREFOX'].includes(v.side) && v.token === this.comparison?.token) {
            if (!await this.allowed())
                fail('PERMISSION');
            const remote = await this.native(this.state.root), local = this.state.pending?.target ?? await this.local();
            if (!same(local, this.comparison.local) || !same(remote.groups, this.comparison.observed))
                return { error: 'COMPARISON_CHANGED' };
            const target = v.side === 'ATLAS' ? local : this.comparison.remote;
            this.state.issue = 'NONE';
            this.state.conflictRemote = null;
            if (this.state.mutation)
                await this.finishMutation();
            await this.synchronize(target, remote.bindings);
            this.comparison = null;
            return this.response();
        }
        return { error: 'INVALID_COMMAND' };
    }
    message = (input, sender) => {
        if (sender.id !== this.api.runtime.id || sender.url?.split(/[?#]/, 1)[0] !== this.api.runtime.getURL('ui/index.html') || (sender.frameId ?? 0) !== 0
            || !input || typeof input !== 'object' || Array.isArray(input) || !presentationCommands.includes(input.kind))
            return false;
        return this.run(async () => { try {
            return await this.dispatch(input);
        }
        catch (e) {
            await this.issue(e);
            return { error: 'PRESENTATION_UNAVAILABLE' };
        } }).catch(() => ({ error: 'PRESENTATION_UNAVAILABLE' }));
    };
    dispose() {
        this.disposed = true;
        this.api.runtime.onMessage.removeListener(this.message);
        this.api.permissions.onAdded.removeListener(this.permissionChanged);
        this.api.permissions.onRemoved.removeListener(this.permissionChanged);
        for (const event of this.listeningEvents)
            event.removeListener(this.changed);
        this.store?.close();
        this.bookmarks?.close();
        this.iconStore?.close();
    }
}
