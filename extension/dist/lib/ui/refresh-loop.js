/** One owned timer and one request. Explicit refreshes cannot start a second poll chain. */
export class RefreshLoop {
    refresh;
    options;
    timer = null;
    running = null;
    requested = false;
    active = false;
    disposed = false;
    constructor(refresh, options) {
        this.refresh = refresh;
        this.options = options;
    }
    setActive(active) {
        if (this.disposed || this.active === active)
            return;
        this.active = active;
        if (active)
            void this.request();
        else {
            this.clear();
            this.requested = false;
        }
    }
    request() {
        if (!this.active || this.disposed)
            return Promise.resolve();
        this.clear();
        if (this.running) {
            this.requested = true;
            return this.running;
        }
        const pending = Promise.resolve().then(this.refresh).finally(() => {
            this.running = null;
            if (!this.active || this.disposed)
                return;
            if (this.requested) {
                this.requested = false;
                void this.request();
            }
            else
                this.timer = (this.options.schedule ?? setTimeout)(() => { this.timer = null; void this.request(); }, this.options.delay());
        });
        this.running = pending;
        return pending;
    }
    clear() {
        if (this.timer !== null)
            (this.options.cancel ?? clearTimeout)(this.timer);
        this.timer = null;
    }
    dispose() { this.disposed = true; this.active = false; this.requested = false; this.clear(); }
}
