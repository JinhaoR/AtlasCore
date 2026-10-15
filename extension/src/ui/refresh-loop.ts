interface RefreshOptions {
  delay(): number;
  schedule?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  cancel?(timer: ReturnType<typeof setTimeout>): void;
}

/** One owned timer and one request. Explicit refreshes cannot start a second poll chain. */
export class RefreshLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private requested = false;
  private active = false;
  private disposed = false;
  constructor(private readonly refresh: () => Promise<void>, private readonly options: RefreshOptions) {}
  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (active) void this.request();
    else { this.clear(); this.requested = false; }
  }
  request(): Promise<void> {
    if (!this.active || this.disposed) return Promise.resolve();
    this.clear();
    if (this.running) { this.requested = true; return this.running; }
    const pending = Promise.resolve().then(this.refresh).finally(() => {
      this.running = null;
      if (!this.active || this.disposed) return;
      if (this.requested) { this.requested = false; void this.request(); }
      else this.timer = (this.options.schedule ?? setTimeout)(() => { this.timer = null; void this.request(); }, this.options.delay());
    });
    this.running = pending;
    return pending;
  }
  private clear(): void {
    if (this.timer !== null) (this.options.cancel ?? clearTimeout)(this.timer);
    this.timer = null;
  }
  dispose(): void { this.disposed = true; this.active = false; this.requested = false; this.clear(); }
}
