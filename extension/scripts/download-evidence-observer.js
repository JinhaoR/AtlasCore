// Isolated native fixture only; never bundled into Atlas. Closed safe projections.
globalThis.downloadEvidence = [];
(() => {
  const host = value => { try { return new URL(value).hostname || null; } catch { return null; } };
  const ids = new Map();
  const id = value => { if (!value) return null; if (!ids.has(value)) ids.set(value, ids.size + 1); return ids.get(value); };
  const record = (event, d) => {
    const headers = d.requestHeaders ?? d.responseHeaders ?? [];
    downloadEvidence.push({ event, request: id(d.requestId), tab: d.tabId ?? (event === 'tabs.onCreated' ? d.id : null),
      sourceTab: d.sourceTabId ?? null, sourceFrame: d.sourceFrameId ?? null,
      opener: d.openerTabId ?? null, host: host(d.url), origin: host(d.originUrl),
      redirect: host(d.redirectUrl), type: d.type ?? null, status: d.statusCode ?? null,
      gesture: headers.some(h => h.name.toLowerCase() === 'sec-fetch-user' && h.value === '?1'),
      attachment: headers.some(h => h.name.toLowerCase() === 'content-disposition' && /^attachment(?:;|$)/i.test(h.value ?? '')),
      html: headers.some(h => h.name.toLowerCase() === 'content-type' && /^text\/html/i.test(h.value ?? '')),
    });
    if (downloadEvidence.length > 1000) downloadEvidence.shift();
  };
  const filter = { urls: ['http://*.localhost/*'], types: ['main_frame', 'other', 'xmlhttprequest'] };
  for (const name of ['onBeforeRequest', 'onBeforeRedirect', 'onResponseStarted', 'onCompleted', 'onErrorOccurred']) {
    const listener = d => { record(name, d); };
    if (name === 'onBeforeRequest') browser.webRequest[name].addListener(listener, filter, ['blocking']);
    else browser.webRequest[name].addListener(listener, filter);
  }
  browser.webRequest.onBeforeSendHeaders.addListener(d => { record('onBeforeSendHeaders', d); }, filter, ['blocking', 'requestHeaders']);
  browser.webRequest.onHeadersReceived.addListener(d => { record('onHeadersReceived', d); }, filter, ['blocking', 'responseHeaders']);
  for (const name of ['onCreatedNavigationTarget', 'onCommitted', 'onErrorOccurred'])
    browser.webNavigation[name].addListener(d => record(`navigation.${name}`, d));
  browser.tabs.onCreated.addListener(d => record('tabs.onCreated', d));
  browser.downloads.onCreated.addListener(d => record('downloads.onCreated', d));
  globalThis.downloadObserverReady = true;
})();
