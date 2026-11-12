let current = null;
export const presentationView = () => current;
export async function presentationCommand(command) {
    const r = await browser.runtime.sendMessage(command);
    if (!r || r.error)
        throw new Error(r?.error ?? 'PRESENTATION_UNAVAILABLE');
    if (r.pins && r.bookmarks && r.sync)
        current = r;
    return r;
}
export const remoteBookmarks = {
    async load() { return (await presentationCommand({ kind: 'PRESENTATION_READ' })).bookmarks; },
    async save(revision, value) { return presentationCommand({ kind: 'BOOKMARK_SAVE', revision, value }); },
    close() { },
};
export async function setPin(id, pinned, hosts = []) {
    try {
        return (await presentationCommand({ kind: 'PIN_SET', id, pinned, hosts })).type;
    }
    catch {
        return 'UNCERTAIN';
    }
}
