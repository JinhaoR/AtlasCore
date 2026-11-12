/** Bounded diagnosis with optional best-effort retention. Never store error messages, function names,
 * arbitrary URLs, event objects or full stacks. Exact own-bundle locations only. */
export class RuntimeDiagnostics {
    backgroundUrl;
    now;
    journal;
    version;
    entries = [];
    sequence = 0;
    startedAt;
    previous = null;
    retention = 'MEMORY_ONLY';
    pendingSave = false;
    saving = null;
    initialized;
    constructor(backgroundUrl, now, journal, version = '0.0.0') {
        this.backgroundUrl = backgroundUrl;
        this.now = now;
        this.journal = journal;
        this.version = version;
        this.startedAt = this.time();
        this.retention = journal ? 'LOADING' : 'MEMORY_ONLY';
        this.initialized = journal ? journal.load().then(value => { this.previous = value; this.retention = 'READY'; }, () => { this.retention = 'UNAVAILABLE'; }) : Promise.resolve();
    }
    time() {
        try {
            const value = this.now();
            return Number.isSafeInteger(value) && value >= 0 ? value : null;
        }
        catch {
            return null;
        }
    }
    record(subsystem, value, controller) {
        try {
            let error = 'OTHER';
            const frames = [];
            if (value !== null && typeof value === 'object') {
                const names = { Error: 'ERROR', TypeError: 'TYPE_ERROR', RangeError: 'RANGE_ERROR',
                    SyntaxError: 'SYNTAX_ERROR', InternalError: 'INTERNAL_ERROR', DataCloneError: 'DATA_CLONE_ERROR',
                    AbortError: 'ABORT_ERROR', InvalidStateError: 'INVALID_STATE_ERROR', QuotaExceededError: 'QUOTA_EXCEEDED_ERROR' };
                try {
                    const name = value.name;
                    if (typeof name === 'string' && Object.hasOwn(names, name))
                        error = names[name];
                }
                catch { /* hostile getter */ }
                try {
                    const stack = value.stack;
                    if (typeof stack === 'string')
                        for (const line of stack.slice(0, 16384).split('\n').slice(0, 40)) {
                            // Firefox's frame delimiter is @. A URL embedded in an error message,
                            // query string or a different extension is not a location. Diagnostic
                            // frames describe an exception; they are never browser authority.
                            const at = line.lastIndexOf('@');
                            if (at < 0 || !/^[A-Za-z0-9_$./<>]*$/.test(line.slice(0, at)))
                                continue;
                            const location = line.slice(at + 1);
                            if (!location.startsWith(`${this.backgroundUrl}:`))
                                continue;
                            const match = /^(\d{1,7}):(\d{1,7})$/.exec(location.slice(this.backgroundUrl.length + 1));
                            if (match && Number(match[1]) > 0 && Number(match[2]) > 0)
                                frames.push({ asset: 'BACKGROUND', line: Number(match[1]), column: Number(match[2]) });
                            if (frames.length === 5)
                                break;
                        }
                }
                catch { /* hostile stack getter */ }
            }
            const at = this.time();
            const context = controller ? { operation: controller.operation, stage: controller.stage, sequence: controller.sequence } : null;
            const same = this.entries.find(entry => entry.subsystem === subsystem && entry.error === error
                && entry.controller?.operation === context?.operation && entry.controller?.stage === context?.stage
                && JSON.stringify(entry.frames) === JSON.stringify(frames));
            if (same) {
                same.count = Math.min(same.count + 1, Number.MAX_SAFE_INTEGER);
                same.lastAt = at;
                same.controller = context;
                this.persist();
                return;
            }
            this.entries.push({ sequence: ++this.sequence, subsystem, error, frames, controller: context, count: 1, firstAt: at, lastAt: at });
            if (this.entries.length > 20)
                this.entries.shift();
            this.persist();
        }
        catch { /* Observation is never required for authorization or recovery. */ }
    }
    persist() {
        if (!this.journal)
            return;
        this.pendingSave = true;
        if (this.saving)
            return;
        this.saving = this.initialized.then(async () => {
            while (this.pendingSave) {
                this.pendingSave = false;
                try {
                    this.retention = await this.journal.save({ version: this.version, startedAt: this.startedAt,
                        faults: structuredClone(this.entries) }) ? 'READY' : 'UNAVAILABLE';
                }
                catch {
                    this.retention = 'UNAVAILABLE';
                }
            }
        }).finally(() => { this.saving = null; if (this.pendingSave)
            this.persist(); });
    }
    /** Tests/host shutdown may await diagnostics, but authorization never does. */
    async settled() { await this.initialized; while (this.saving)
        await this.saving; }
    read() { return { startedAt: this.startedAt, faults: structuredClone(this.entries), retention: this.retention, previousSession: structuredClone(this.previous) }; }
}
