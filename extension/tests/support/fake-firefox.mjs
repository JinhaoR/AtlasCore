export class Event {
  listeners = [];
  addListener = (listener, ...options) => { this.listeners.push({ listener, options }); };
  removeListener = (listener) => { this.listeners = this.listeners.filter((item) => item.listener !== listener); };
  emit(...args) { return this.listeners.map(({ listener }) => listener(...args)); }
}

export class FakeFirefox {
  nextTab = 1;
  eventTime = 1;
  nextRequest = 1;
  nextTimer = 1;
  requests = new Map();
  documents = new Map();
  updates = [];
  timers = new Map();
  failUpdate = false;
  failRemove = false;
  autoArriveUI = true;
  runtime = { id: 'atlas-test', getURL: (path) => `moz-extension://atlas-test/${path}`, onMessage: new Event() };
  webRequest = { onBeforeRequest: new Event(), onErrorOccurred: new Event(), onBeforeRedirect: new Event() };
  webNavigation = { onCommitted: new Event(), onHistoryStateUpdated: new Event(), onReferenceFragmentUpdated: new Event() };
  badges = new Map();
  titles = new Map();
  badgeUpdates = [];
  browserAction = { onClicked: new Event(),
    setBadgeText: async ({ tabId, text }) => { this.badges.set(tabId, text); this.badgeUpdates.push({ tabId, text }); },
    setTitle: async ({ tabId, title }) => { this.titles.set(tabId, title); }, setBadgeBackgroundColor: async () => {} };
  settle = async () => {};
  tabs = {
    onRemoved: new Event(), onUpdated: new Event(),
    create: async ({ url = 'about:blank', active = true }) => {
      const tab = { id: this.nextTab++, url, active, incognito: false };
      this.documents.set(tab.id, tab);
      return { ...tab };
    },
    get: async (id) => {
      const tab = this.documents.get(id);
      if (!tab) throw new Error('No tab');
      return { ...tab };
    },
    query: async () => [...this.documents.values()].map((tab) => ({ ...tab })),
    update: async (id, { url, active }) => {
      if (this.failUpdate) throw new Error('Update failed');
      if (!this.documents.has(id)) throw new Error('No tab');
      if (url !== undefined) this.updates.push({ id, url });
      if (active !== undefined) this.documents.get(id).active = active;
      if (url?.startsWith('moz-extension:') && this.autoArriveUI) this.arrive(id, url);
      return { ...this.documents.get(id), ...(url === undefined ? {} : { url }) };
    },
    remove: async (id) => {
      if (this.failRemove) throw new Error('Remove failed');
      this.documents.delete(id);
      this.tabs.onRemoved.emit(id, {});
    },
  };
  schedule = (fn, delay) => { const id = this.nextTimer++; this.timers.set(id, { fn, delay }); return id; };
  unschedule = (id) => { this.timers.delete(id); };
  runTimers(delay = 0) {
    for (const [id, timer] of [...this.timers]) {
      if (timer.delay === delay) { this.timers.delete(id); timer.fn(); }
    }
  }
  async send(command, sender = { id: this.runtime.id, url: this.runtime.getURL('ui/index.html'), frameId: 0 }) {
    return await this.runtime.onMessage.emit(command, sender)[0];
  }
  async flush() {
    await this.settle();
    this.runTimers();
    await this.settle();
    // A tabs.update queues arrival behind the current effect.
    await this.settle();
  }
  async request(id, url, options = {}) {
    const details = { type: 'main_frame', frameId: 0,
      tabId: id, url, requestId: String(this.nextRequest++), timeStamp: this.eventTime++, method: 'GET', ...options };
    this.requests.set(id, details);
    return await this.webRequest.onBeforeRequest.emit(details)[0];
  }
  async redirect(id, url, arrive = true) {
    const previous = this.requests.get(id);
    this.webRequest.onBeforeRedirect.emit({ ...previous, timeStamp: this.eventTime++, redirectUrl: url });
    const result = await this.request(id, url, { requestId: previous.requestId });
    if (arrive && !result.cancel) this.arrive(id, url);
    await this.flush();
    return result;
  }
  arrive(id, url, options = {}) {
    this.badges.delete(id); this.titles.delete(id); // Firefox resets tab-scoped toolbar properties.
    this.documents.set(id, { id, url, incognito: false });
    this.webNavigation.onCommitted.emit({ tabId: id, frameId: 0, url, timeStamp: this.eventTime++, ...options });
  }
  async visit(id, url, options = {}) {
    const result = await this.request(id, url, options);
    if (!result.cancel) this.arrive(id, url);
    await this.flush();
    return result;
  }
}
