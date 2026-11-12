import type { DestinationEntry } from './destinations.js';
import { destinationEntryPoints, destinationId } from './home-model.js';
import { loadWebsiteIcon } from './website-icons.js';
import { createWebsiteIconCache } from './website-icon-cache.js';
import { setAttribute, setProperty } from './dom.js';

export function icon(name: string): SVGSVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); node.classList.add('icon'); setAttribute(node, 'aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); setAttribute(use, 'href', `#icon-${name}`); node.append(use); return node;
}

/** Own the launcher DOM, icon requests and their page-lifetime cleanup.
 * The parent owns pins/state; opening always goes through its ordinary Core gate. */
export function initializeDestinationCards(options: { open(url: string): Promise<unknown>; togglePin(id: string): void }) {
  let disposed = false;
  const websiteIcons = new Map<string, Promise<string | null>>();
  const observedIcons = new Map<string, string>();
  const assetCache = createWebsiteIconCache(browser.extension?.inIncognitoContext ? null : globalThis.caches);
  const iconSnapshot = browser.tabs.query({}).then((tabs) => {
    if (disposed) return;
    for (const tab of tabs) if (tab.url && tab.favIconUrl) {
      try { const hostname = new URL(tab.url).hostname; if (!observedIcons.has(hostname)) observedIcons.set(hostname, tab.favIconUrl); } catch { /* No website metadata. */ }
    }
  }).catch(() => { /* Public site lookup remains available without tab metadata. */ });
  const iconObserver = new IntersectionObserver((changes) => {
    for (const change of changes) if (change.isIntersecting) {
      iconObserver.unobserve(change.target);
      const image = change.target as HTMLImageElement;
      void displayWebsiteIcon(image, image.dataset.hostname!);
    }
  }, { rootMargin: '160px' });

  async function displayWebsiteIcon(image: HTMLImageElement, hostname: string, refresh = false): Promise<void> {
    if (disposed) return;
    setProperty(image.dataset, 'hostname', hostname);
    if (!websiteIcons.has(hostname)) websiteIcons.set(hostname, (async () => {
      const cached = refresh ? null : await assetCache.read(hostname);
      if (cached || disposed) return cached;
      await iconSnapshot;
      const blob = disposed ? null : await loadWebsiteIcon(hostname, observedIcons.get(hostname));
      if (blob) void assetCache.write(hostname, blob);
      return blob;
    })()
      .then((blob) => blob && !disposed ? URL.createObjectURL(blob) : null).catch(() => null));
    const loading = websiteIcons.get(hostname)!;
    const url = await loading;
    // Entry point changes and policy redraws can outlive an earlier lookup.
    if (!image.isConnected || image.dataset.hostname !== hostname || websiteIcons.get(hostname) !== loading) return;
    if (image.getAttribute('src') !== (url ?? 'site.svg')) image.src = url ?? 'site.svg';
  }

  function makeSiteMark(hostname: string, existing?: HTMLElement): HTMLElement {
    if (existing) {
      if (existing.dataset.hostname === hostname) return existing;
      const image = existing.querySelector<HTMLImageElement>('img')!;
      setProperty(existing.dataset, 'hostname', hostname); setProperty(image.dataset, 'hostname', hostname);
      image.src = 'site.svg'; iconObserver.observe(image); return existing;
    }
    const mark = document.createElement('span'); mark.className = 'service-mark'; setAttribute(mark, 'aria-hidden', 'true');
    setProperty(mark.dataset, 'hostname', hostname);
    const image = document.createElement('img'); image.className = 'site-icon'; image.width = 32; image.height = 32;
    image.alt = ''; image.src = 'site.svg'; image.loading = 'lazy'; setProperty(image.dataset, 'hostname', hostname);
    image.addEventListener('error', () => { if (!image.src.endsWith('/site.svg')) image.src = 'site.svg'; });
    mark.append(image); iconObserver.observe(image); return mark;
  }

  function makeDestinationCard(entry: DestinationEntry): HTMLElement {
    const card = document.createElement('div'); card.className = 'destination-card'; setProperty(card.dataset, 'destinationId', destinationId(entry));
    const points = destinationEntryPoints(entry);
    const addresses = document.createElement('select'); addresses.className = 'service-addresses'; setAttribute(addresses, 'aria-label', `${entry.label} entry point`);
    points.forEach((hostname) => addresses.append(new Option(hostname, hostname))); setProperty(addresses, 'hidden', points.length < 2);
    const open = document.createElement('button'); open.className = 'destination-open'; open.type = 'button'; setAttribute(open, 'aria-label', `Open ${entry.label}`);
    setProperty(open.dataset, 'destinationId', destinationId(entry));
    setProperty(open, 'title', entry.hostnames.join(', '));
    const mark = makeSiteMark(addresses.value), image = mark.querySelector<HTMLImageElement>('img')!;
    const copy = document.createElement('span'); copy.className = 'destination-copy';
    const name = document.createElement('span'); name.className = 'destination-name'; setProperty(name, 'textContent', entry.label);
    const host = document.createElement('span'); host.className = 'destination-host'; setProperty(host, 'textContent', addresses.value);
    addresses.addEventListener('change', () => { setProperty(host, 'textContent', addresses.value); setProperty(open, 'title', addresses.value); void displayWebsiteIcon(image, addresses.value); });
    copy.append(name, host); open.append(mark, copy);
    open.addEventListener('click', () => { void options.open(`https://${addresses.value}/`); });
    const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'pin-button'; setProperty(pin.dataset, 'pinId', destinationId(entry)); setProperty(pin.dataset, 'label', entry.label); pin.append(icon('pin'));
    pin.addEventListener('click', () => { options.togglePin(destinationId(entry)); });
    card.append(open, pin);
    if (points.length > 1) {
      const details = document.createElement('details'); details.className = 'entry-points';
      const summary = document.createElement('summary'); setProperty(summary, 'title', `Choose ${entry.label} entry point`);
      setAttribute(summary, 'aria-label', summary.title); summary.append(icon('chevron'));
      details.append(summary, addresses); card.append(details);
    }
    return card;
  }

  function observeWebsiteIcon(_tabId: number, changes: browser.tabs._OnUpdatedChangeInfo, tab: browser.tabs.Tab): void {
    if ((!changes.favIconUrl && !changes.url) || !tab.url || !tab.favIconUrl) return;
    try {
      const hostname = new URL(tab.url).hostname;
      if (observedIcons.get(hostname) === tab.favIconUrl) return;
      observedIcons.set(hostname, tab.favIconUrl);
      const previous = websiteIcons.get(hostname); websiteIcons.delete(hostname);
      if (previous) void previous.then(url => { if (url) URL.revokeObjectURL(url); });
      for (const image of document.querySelectorAll<HTMLImageElement>('.site-icon')) if (image.dataset.hostname === hostname)
        void displayWebsiteIcon(image, hostname, true);
    } catch { /* Missing/unsupported website metadata creates no icon or permission. */ }
  }
  browser.tabs.onUpdated.addListener(observeWebsiteIcon);
  function dispose(): void {
    disposed = true;
    iconObserver.disconnect(); browser.tabs.onUpdated.removeListener(observeWebsiteIcon);
    for (const promise of websiteIcons.values()) void promise.then(url => { if (url) URL.revokeObjectURL(url); });
    websiteIcons.clear(); observedIcons.clear();
  }
  return { create: makeDestinationCard, siteMark: makeSiteMark, dispose };
}
