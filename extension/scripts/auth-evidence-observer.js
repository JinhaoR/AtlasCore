// Investigation only. Added to a disposable copy of the built extension by the
// native probe; never imported by production entry points or used to authorize.
(() => {
  const limit = 4000;
  let entries = [];
  let sequence = 0;
  let dropped = 0;
  const requests = new Map();
  const documents = new Map();
  const ui = browser.runtime.getURL('ui/index.html');
  const host = (value) => {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.hostname : null;
    } catch { return null; }
  };
  const token = (map, value) => {
    if (typeof value !== 'string') return null;
    if (!map.has(value)) map.set(value, map.size + 1);
    return map.get(value);
  };
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const text = (value, permitted) => permitted.includes(value) ? value : null;
  function record(event, details) {
    // A closed projection is essential: no headers, body, cookies, tokens, raw
    // errors, URLs, query names/values, page content or raw browser IDs survive.
    const item = {
      sequence: ++sequence, event, timeStamp: numeric(details.timeStamp),
      hostname: host(details.url), redirectHostname: host(details.redirectUrl),
      originHostname: host(details.originUrl), documentHostname: host(details.documentUrl),
      initiatorHostname: host(details.initiator),
      request: token(requests, details.requestId), document: token(documents, details.documentId),
      parentDocument: token(documents, details.parentDocumentId),
      tabId: numeric(details.tabId ?? details.id), frameId: numeric(details.frameId),
      parentFrameId: numeric(details.parentFrameId), sourceTabId: numeric(details.sourceTabId),
      sourceFrameId: numeric(details.sourceFrameId), openerTabId: numeric(details.openerTabId),
      method: text(details.method, ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
      type: text(details.type, ['main_frame', 'sub_frame']), statusCode: numeric(details.statusCode),
      transitionType: text(details.transitionType, ['link', 'typed', 'auto_bookmark', 'auto_subframe',
        'manual_subframe', 'generated', 'start_page', 'form_submit', 'reload', 'keyword', 'keyword_generated']),
      transitionQualifiers: Array.isArray(details.transitionQualifiers)
        ? details.transitionQualifiers.filter((value) => ['client_redirect', 'server_redirect', 'forward_back', 'from_address_bar'].includes(value)) : [],
      ancestors: Array.isArray(details.frameAncestors) ? details.frameAncestors.map((ancestor) =>
        ({ frameId: numeric(ancestor.frameId), hostname: host(ancestor.url) })) : [],
      failed: event.endsWith('onErrorOccurred'),
    };
    entries.push(item);
    if (entries.length > limit) { entries.shift(); dropped++; }
  }
  const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] };
  for (const name of ['onBeforeRequest', 'onBeforeRedirect', 'onResponseStarted', 'onCompleted', 'onErrorOccurred']) {
    browser.webRequest[name].addListener((details) => record(`webRequest.${name}`, details), filter);
  }
  for (const name of ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted',
    'onErrorOccurred', 'onCreatedNavigationTarget', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated']) {
    browser.webNavigation[name].addListener((details) => record(`webNavigation.${name}`, details));
  }
  browser.tabs.onCreated.addListener((details) => record('tabs.onCreated', details));
  browser.tabs.onRemoved.addListener((id) => record('tabs.onRemoved', { tabId: id }));
  // A private port avoids competing with the production command bridge.
  browser.runtime.onConnect.addListener((port) => {
    const sender = port.sender;
    if (port.name !== 'auth-evidence' || sender?.id !== browser.runtime.id
      || sender.url?.split(/[?#]/, 1)[0] !== ui || (sender.frameId ?? 0) !== 0) {
      port.disconnect(); return;
    }
    port.onMessage.addListener((input) => {
      if (input === null || typeof input !== 'object' || Object.keys(input).length !== 1
        || !Object.hasOwn(input, 'kind') || !['READ', 'RESET'].includes(input.kind)) {
        port.postMessage({ error: 'INVALID_COMMAND' }); return;
      }
      if (input.kind === 'RESET') {
        entries = []; sequence = 0; dropped = 0; requests.clear(); documents.clear();
      }
      port.postMessage({ entries, dropped });
    });
  });
})();
