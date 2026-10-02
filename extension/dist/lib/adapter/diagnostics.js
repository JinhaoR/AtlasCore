/** Memory only. Callers supply a closed, hostname-only observation, never browser event objects. */
export class Diagnostics {
    sequence = 0;
    entries = [];
    add(entry) {
        this.entries.push(structuredClone({ ...entry, sequence: ++this.sequence }));
        if (this.entries.length > 200)
            this.entries.shift();
    }
    read(tabId = null) {
        return structuredClone(this.entries.filter((entry) => tabId === null || entry.tabId === tabId));
    }
    clear() { this.entries = []; }
}
