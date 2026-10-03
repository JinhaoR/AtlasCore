import {
  normalizeTarget, type AtlasController, type AtlasControllerResponse, type AtlasControllerView,
  type AtlasNavigationContext, type Journey, type JourneyContinuation, type SiteTarget,
} from '@atlas/core';
import type { InitializableRepository } from '../storage/indexeddb-repository.js';
import { Diagnostics, type DiagnosticEntry } from './diagnostics.js';
import type { ManagedBlacklistManager, ManagedView } from '../managed/manager.js';
import { compileCuratedWhitelist } from '../presets/curated-whitelist.js';
import { equivalentServiceHostnames } from '../presets/access-aliases.js';
import { journeyIndicator, journeyPresentation, journeyRetry } from './journey-indicator.js';
import { temporaryAccessView, type TemporaryAccess } from './temporary-access.js';
import { canonicalDiscoveryOrigin, canonicalEntryCounterpart, type CanonicalEntryDiscovery } from './canonical-entry.js';

export interface AdapterHost {
  readonly controller: AtlasController;
  readonly repository: InitializableRepository;
  readonly managed?: ManagedBlacklistManager;
}

type Firefox = Pick<typeof browser, 'tabs' | 'webRequest' | 'webNavigation' | 'runtime' | 'browserAction'>;
type Response = AtlasControllerResponse | { readonly type: 'ADAPTER_ERROR'; readonly reason: string };
type BeforeRequest = browser.webRequest._OnBeforeRequestDetails;
type Arrival = browser.webNavigation._OnCommittedDetails;
interface Destination { target: SiteTarget; origin: string }
interface Flight {
  requestId: string; url: string; timeStamp: number; destination: Destination | null;
  released: boolean; journeyId: number | null;
  authority: Extract<AtlasControllerResponse, { type: 'ASSESSMENT' }> | null;
  redirectUrl: string | null;
  method: 'GET' | 'POST' | 'OTHER'; sourceHostname: string | null;
  continuationKind: JourneyContinuation['kind'] | null;
}
interface Context {
  tabId: number; id: string; generation: number; flight: Flight | null; launching: boolean;
  requested: Destination | null; displayed: Destination | null;
  displayedDecision: AtlasControllerResponse | null; latest: Response | null;
  effect: 'NONE' | 'REMOVING' | 'REMOVED' | 'FAILED'; removalTimer: number | null;
  lastArrival: number; navigationId: number; badge: string;
  pill: string; rootOrigin: { journeyId: number; origin: string } | null;
  accessScope: PreparedAccessScope | null;
}

/** A disclosed request draft, never an authorization decision or saved alias. */
export interface AccessScopePreview {
  readonly id: string;
  readonly status: 'PREPARING' | 'READY';
  readonly hostnames: readonly string[];
  readonly source: 'DECLARED' | 'CANONICAL_REDIRECT' | 'EXACT';
}
interface PreparedAccessScope {
  generation: number; origin: string; policyRevision: number;
  preview: AccessScopePreview; work: Promise<void>;
}

export interface AdapterView {
  readonly controller: AtlasControllerView | null;
  readonly managed: ManagedView | null;
  readonly temporaryAccess: readonly TemporaryAccess[] | null;
  readonly contexts: readonly {
    tabId: number; contextId: string; navigationId: number; hostname: string | null; displayedHostname: string | null;
    latest: Response | null; journey: Journey | null; effect: Context['effect'];
    retry: ReturnType<typeof journeyRetry>;
    accessScope: AccessScopePreview | null;
  }[];
}

function destination(url: string): Destination | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const target = normalizeTarget(url);
  if (target === null) return null;
  return { target, origin: new URL(url).origin };
}
const withoutFragment = (url: string) => url.split('#', 1)[0]!;
const allowed = (result: Response): result is Extract<AtlasControllerResponse, { type: 'ASSESSMENT' }> =>
  result.type === 'ASSESSMENT' && result.decision.outcome === 'ALLOW';
const error = (reason: string): Response => ({ type: 'ADAPTER_ERROR', reason });

/** Browser facts and effects only. Every permission is obtained from the shared Core controller. */
export class FirefoxAdapter {
  private readonly contexts = new Map<number, Context>();
  private queue: Promise<unknown> = Promise.resolve();
  private host: AdapterHost | null = null;
  private refreshPending: Promise<void> | null = null;
  private stopped = false;
  private nextNavigation = 0;
  private nextAccessScope = 0;
  private readonly diagnostics = new Diagnostics();
  readonly ready: Promise<void>;
  readonly uiUrl: string;

  constructor(
    private readonly api: Firefox,
    host: Promise<AdapterHost>,
    private readonly newContextId: () => string,
    private readonly now: () => number,
    private readonly schedule: (callback: () => void, delay: number) => number = (callback, delay) => setTimeout(callback, delay),
    private readonly unschedule: (id: number) => void = (id) => clearTimeout(id),
    private readonly discoverCanonicalEntry?: CanonicalEntryDiscovery,
  ) {
    this.uiUrl = api.runtime.getURL('ui/index.html');
    // Listeners are installed synchronously, before loading authority.
    api.webRequest.onBeforeRequest.addListener(this.beforeRequest,
      { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['blocking']);
    api.webRequest.onErrorOccurred.addListener(this.requestFailed,
      { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
    api.webRequest.onBeforeRedirect.addListener(this.redirected,
      { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });
    api.webNavigation.onCommitted.addListener(this.arrived);
    api.webNavigation.onHistoryStateUpdated.addListener(this.changed);
    api.webNavigation.onReferenceFragmentUpdated.addListener(this.changed);
    api.tabs.onRemoved.addListener(this.closed);
    api.tabs.onUpdated.addListener(this.updated);
    api.runtime.onMessage.addListener(this.message);
    api.browserAction.onClicked.addListener(this.toolbar);
    this.ready = host.then(async (value) => {
      this.host = value;
      await value.controller.open();
    }).catch(() => { this.host = null; });
  }

  private run<T>(work: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(async () => {
      await this.ready;
      try { return await work(); }
      finally {
        const status = this.host?.controller.getView().status;
        if (status === 'UNAVAILABLE' || status === 'RECONCILING') {
          for (const context of this.contexts.values()) if (context.latest !== null) this.publish(context, context.latest);
        }
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Wait for queued adapter effects; read-only views deliberately do not wait. */
  whenIdle(): Promise<unknown> { return this.queue; }

  /** Only schedules publication; managed membership and precedence remain in Core. */
  publishManagedUpdate(work: () => Promise<boolean>): Promise<boolean> { return this.run(work); }

  private context(tabId: number): Context {
    let context = this.contexts.get(tabId);
    if (context === undefined) {
      context = { tabId, id: this.newContextId(), generation: 0, flight: null, launching: false,
        requested: null, displayed: null, displayedDecision: null, latest: null,
        effect: 'NONE', removalTimer: null, lastArrival: -1, navigationId: 0, badge: '', pill: '', rootOrigin: null,
        accessScope: null };
      this.contexts.set(tabId, context);
    }
    return context;
  }

  private live(context: Context, generation: number): boolean {
    return !this.stopped && this.contexts.get(context.tabId) === context && context.generation === generation;
  }

  private journey(context: Context): Journey | null {
    return this.host?.controller.getView().snapshot?.journeyState.journeys
      .find((journey) => journey.contextId === context.id) ?? null;
  }

  private binding(context: Context, continuation?: JourneyContinuation): AtlasNavigationContext {
    return { contextId: context.id, journeyId: this.journey(context)?.id ?? null,
      ...(continuation === undefined ? {} : { continuation }) };
  }

  private trace(event: DiagnosticEntry['event'], context: Context,
    result: Response | null = context.latest, hostname = context.requested?.target.hostname ?? null): void {
    // Diagnostics never participate in authorization, including on diagnostic failure.
    try {
      const journey = this.journey(context);
      const at = this.now();
      this.diagnostics.add({ event, at: Number.isSafeInteger(at) ? at : null,
        tabId: context.tabId, contextId: context.id, navigationId: context.navigationId, hostname,
        outcome: result?.type === 'ASSESSMENT' ? result.decision.outcome : result?.type ?? null,
        reason: result?.type === 'ASSESSMENT' ? result.decision.reason
          : result !== null && 'reason' in result ? result.reason : null,
        method: context.flight?.method ?? null, sourceHostname: context.flight?.sourceHostname ?? null,
        continuationKind: context.flight?.continuationKind ?? null,
        journey: journey === null ? null : { id: journey.id, phase: journey.phase,
          rootHostname: journey.rootHostname, hopCount: journey.hopCount,
          maxHops: journey.maxHops, expiresAt: journey.expiresAt, endReason: journey.endReason } });
    } catch { /* Observability failure cannot release or cancel a navigation. */ }
  }

  private publish(context: Context, result: Response): void {
    const signature = (response: Response | null) => response?.type === 'ASSESSMENT'
      ? JSON.stringify(response.decision) : JSON.stringify(response);
    if (signature(context.latest) !== signature(result)) this.trace('DECISION', context, result);
    context.latest = result;
    this.publishJourney(context);
    const authority = this.host?.controller.getView() ?? null;
    const unavailable = authority?.status === 'UNAVAILABLE' || authority?.status === 'RECONCILING';
    const decision = result.type === 'ASSESSMENT' ? result.decision : null;
    const journey = this.journey(context);
    const indicator = decision?.outcome === 'ALLOW'
      ? journeyIndicator(authority, journey, this.now()) : null;
    const text = unavailable ? '!' : decision?.outcome === 'ALLOW' ? indicator !== null ? 'J' : ''
      : decision?.outcome === 'WAIT' ? 'WAIT' : decision?.outcome === 'REQUIRE_CONFIRMATION' ? 'GO' : '!';
    const title = unavailable ? 'Atlas · Access unavailable' : indicator ?? `Atlas · ${decision?.outcome ?? result.type} · ${decision?.reason ?? ('reason' in result ? result.reason : '')}`;
    const badge = `${text}:${title}`;
    if (context.badge === badge) return;
    context.badge = badge;
    void Promise.allSettled([
      this.api.browserAction.setBadgeText({ tabId: context.tabId, text }),
      this.api.browserAction.setTitle({ tabId: context.tabId, title }),
      this.api.browserAction.setBadgeBackgroundColor({ tabId: context.tabId,
        color: decision?.outcome === 'ALLOW' ? '#24675c' : '#895327' }),
    ]);
  }

  private pageJourney(context: Context): ReturnType<typeof journeyPresentation> {
    const journey = this.journey(context);
    if (context.flight !== null || context.launching || context.displayed === null
      || context.latest === null || !allowed(context.latest)
      || !('target' in context.latest.decision) || context.latest.decision.target?.hostname !== context.displayed.target.hostname
      || journey?.currentHostname !== context.displayed.target.hostname) return null;
    return journeyPresentation(this.host?.controller.getView() ?? null, journey, this.now());
  }

  private publishJourney(context: Context): void {
    const presentation = this.pageJourney(context);
    const key = JSON.stringify([context.generation, presentation]);
    if (context.pill === key) return;
    context.pill = key;
    // Passive display only. Content scripts have no privileged command channel.
    void this.api.tabs.sendMessage(context.tabId, { kind: 'ATLAS_JOURNEY_DISPLAY', presentation }, { frameId: 0 })
      .catch(() => { if (context.pill === key) context.pill = ''; });
  }

  private async check(context: Context, target: SiteTarget, record = false,
    continuation?: JourneyContinuation, begin = false): Promise<Response> {
    return this.host?.controller.handle({ kind: record ? 'RECORD_JOURNEY_NAVIGATION' : begin ? 'BEGIN_NAVIGATION' : 'CHECK_NAVIGATION',
      target, context: this.binding(context, continuation) }) ?? error('STORAGE_UNAVAILABLE');
  }

  private async loseJourney(context: Context): Promise<void> {
    const journey = this.journey(context);
    if (journey !== null && journey.phase !== 'ENDED') {
      await this.host?.controller.handle({ kind: 'CLOSE_JOURNEY_CONTEXT',
        contextId: context.id, journeyId: journey.id });
      this.trace('CONTEXT_CLOSED', context);
    }
  }

  private async abandonUnreleasedDeparture(context: Context, flight: Flight): Promise<void> {
    // A saved first hop was never executed. End only that still-bound attempt,
    // before the newer queued request receives a fresh Core assessment.
    if (!this.stopped && this.contexts.get(context.tabId) === context && !flight.released
      && flight.journeyId !== null && this.journey(context)?.id === flight.journeyId) {
      await this.loseJourney(context);
    }
  }

  private clearRemoval(context: Context): void {
    if (context.removalTimer !== null) this.unschedule(context.removalTimer);
    context.removalTimer = null;
  }

  private beforeRequest = (details: BeforeRequest): Promise<browser.webRequest.BlockingResponse> => {
    // Firefox does not turn listener exceptions into denials. Never let this gate reject.
    try { return this.gate(details).catch(() => ({ cancel: true })); }
    catch { return Promise.resolve({ cancel: true }); }
  };

  private gate = (details: BeforeRequest): Promise<browser.webRequest.BlockingResponse> => {
    if (details.type !== 'main_frame' || details.frameId !== 0 || !/^https?:\/\//i.test(details.url)) {
      return Promise.resolve({});
    }
    if (details.tabId < 0 || this.stopped) return Promise.resolve({ cancel: true });
    const context = this.context(details.tabId);
    const previous = context.flight;
    const correlated = previous !== null && previous.released && previous.requestId === details.requestId
      && previous.redirectUrl === withoutFragment(details.url) && previous.timeStamp <= details.timeStamp;
    const initiator = details.originUrl === undefined ? null : destination(details.originUrl);
    const sourceDocument = context.displayed;
    const sourceAuthority = context.displayedDecision;
    if (context.flight !== null && (!context.flight.released || context.flight.requestId !== details.requestId))
      this.trace('SUPERSEDED', context);
    const generation = ++context.generation;
    context.navigationId = ++this.nextNavigation;
    context.launching = false;
    this.clearRemoval(context);
    context.effect = 'NONE';
    const flight: Flight = { requestId: details.requestId, url: withoutFragment(details.url),
      timeStamp: details.timeStamp, destination: destination(details.url), released: false, journeyId: null, authority: null, redirectUrl: null,
      method: details.method === 'GET' || details.method === 'POST' ? details.method : 'OTHER',
      sourceHostname: initiator?.target.hostname ?? null, continuationKind: null };
    context.flight = flight;
    context.requested = flight.destination;
    this.trace('REQUEST', context, null);
    // Invalidate earlier work before joining the queue, including a result waiting on a save.
    return this.run(async () => {
      if (!this.live(context, generation)) return { cancel: true };
      const active = this.journey(context);
      // Attest the authorization cursor, including a root traversed without document arrival.
      // Request ID alone never proves a redirect: the expected target must also match.
      const existingContinuation: JourneyContinuation | undefined = active !== null && active.phase !== 'ENDED'
        ? correlated && previous.journeyId === active.id
          ? { kind: 'HTTP_REDIRECT', sourceHostname: active.currentHostname }
          : initiator?.target.hostname === context.displayed?.target.hostname
            && initiator?.target.hostname === active.currentHostname
            && flight.destination?.target.hostname === active.currentHostname
            ? { kind: 'SAME_HOST', sourceHostname: active.currentHostname }
            : active.phase === 'IN_TRANSIT' && details.method === 'POST'
              && context.displayed?.target.hostname === active.currentHostname
              && initiator?.origin === context.displayed?.origin
              && context.displayedDecision !== null && allowed(context.displayedDecision)
              ? { kind: 'FORM_POST', sourceHostname: active.currentHostname } : undefined
        : undefined;
      // Browser provenance establishes one departure from the actual loaded root,
      // never authentication purpose. Core revalidates its current Whitelist status.
      const rootDeparture = sourceDocument !== null && context.displayed === sourceDocument
        && sourceAuthority !== null && allowed(sourceAuthority) && sourceAuthority.decision.reason === 'WHITELISTED'
        && initiator?.origin === sourceDocument.origin
        && flight.destination !== null && flight.destination.target.hostname !== sourceDocument.target.hostname
        && (active === null || active.phase === 'ENDED'
          || active.phase === 'STARTED' && active.rootHostname === sourceDocument.target.hostname);
      const continuation: JourneyContinuation | undefined = existingContinuation
        ?? (rootDeparture ? { kind: 'ROOT_DEPARTURE', sourceHostname: sourceDocument.target.hostname } : undefined);
      flight.continuationKind = continuation?.kind ?? null; // Diagnostic projection only.
      let result: Response = flight.destination === null ? error('INVALID_TARGET')
        : await this.check(context, flight.destination.target, false, continuation, true);
      const journey = this.journey(context);
      flight.journeyId = journey?.id ?? null;
      if (!this.live(context, generation)) {
        if (rootDeparture) await this.abandonUnreleasedDeparture(context, flight);
        return { cancel: true };
      }
      if (allowed(result) && journey !== null && journey.phase !== 'ENDED'
        && journey.rootHostname === flight.destination?.target.hostname && context.rootOrigin?.journeyId !== journey.id)
        context.rootOrigin = { journeyId: journey.id, origin: flight.destination.origin };
      if (allowed(result) && journey !== null && journey.phase !== 'ENDED'
        && continuation?.kind === 'ROOT_DEPARTURE' && journey.rootHostname === sourceDocument?.target.hostname)
        context.rootOrigin = { journeyId: journey.id, origin: sourceDocument.origin };
      if (allowed(result) && journey !== null && journey.phase !== 'ENDED'
        && flight.destination!.target.hostname !== journey.rootHostname) {
        result = await this.check(context, flight.destination!.target, true, continuation);
      }
      if (!this.live(context, generation)) {
        if (rootDeparture) await this.abandonUnreleasedDeparture(context, flight);
        return { cancel: true };
      }
      // A browser effect can only use the lifetime returned by Core; this guard only vetoes.
      if (allowed(result) && 'expiresAt' in result.decision && this.now() >= result.decision.expiresAt) {
        result = error('RECHECK_REQUIRED');
      }
      this.publish(context, result);
      if (allowed(result)) {
        flight.released = true;
        flight.authority = result;
        this.trace('RELEASED', context, result);
        return {};
      }
      // Let Firefox receive cancellation before changing its tab to the private UI.
      this.schedule(() => { void this.run(() => this.removeContent(context, generation)); }, 0);
      return { cancel: true };
    }).catch(() => {
      if (this.live(context, generation)) {
        this.publish(context, error('ADAPTER_FAILURE'));
        this.schedule(() => { void this.run(() => this.removeContent(context, generation)); }, 0);
      }
      return { cancel: true };
    });
  };

  private async removeContent(context: Context, generation: number): Promise<void> {
    if (!this.live(context, generation)) return;
    context.flight = null;
    context.launching = false;
    context.effect = 'REMOVING';
    this.clearRemoval(context);
    context.removalTimer = this.schedule(() => {
      if (this.live(context, generation) && context.effect === 'REMOVING') void this.closeUncontrolled(context);
    }, 3000);
    try {
      // update resolves before document arrival: only arrived/recheck may report REMOVED.
      await this.api.tabs.update(context.tabId, { url: `${this.uiUrl}?view=access&tab=${context.tabId}` });
    } catch {
      if (this.live(context, generation)) await this.closeUncontrolled(context);
    }
  }

  private async closeUncontrolled(context: Context): Promise<void> {
    this.clearRemoval(context);
    try { await this.api.tabs.remove(context.tabId); }
    catch { context.effect = 'FAILED'; this.publish(context, error('CONTENT_REMOVAL_FAILED')); }
  }

  private acknowledgeRemoval(context: Context): void {
    if (context.effect !== 'REMOVED') this.trace('CONTENT_REMOVED', context);
    this.clearRemoval(context);
    context.effect = 'REMOVED';
    context.displayed = null;
    context.displayedDecision = null;
    context.flight = null;
    context.launching = false;
  }

  private arrived = (details: Arrival): void => {
    if (details.frameId !== 0 || this.stopped) return;
    const context = this.context(details.tabId);
    const generation = context.generation;
    const received = destination(details.url);
    const released = context.flight;
    const receivedJourney = this.journey(context);
    const matchedAtReceipt = received !== null && released !== null && released.released && released.authority !== null
      && released.url === withoutFragment(details.url) && released.timeStamp <= details.timeStamp
      && details.timeStamp > context.lastArrival;
    if (matchedAtReceipt) {
      // Capture the browser fact before an immediate form submission can supersede
      // queued processing. This uses an already saved released-request assessment.
      context.displayed = received;
      context.displayedDecision = released.authority;
    } else if (received === null && !/^https?:\/\//i.test(details.url)
      && details.timeStamp > context.lastArrival) {
      // Replacing the loaded document also retires its source authority. Capture
      // this veto before a following request can supersede queued reconciliation.
      // Retiring the source leaves a newer held HTTP request or launch intact.
      context.displayed = null;
      context.displayedDecision = null;
    }
    void this.run(async () => {
      if (details.timeStamp <= context.lastArrival) return;
      if (!this.live(context, generation)) {
        // New requests may supersede publication, but not a real arrival's domain
        // bookkeeping. In particular, a root arrival must end the old attempt before
        // the following root login request starts its fresh one.
        if (this.stopped || this.contexts.get(context.tabId) !== context || received === null
          || receivedJourney === null || this.journey(context)?.id !== receivedJourney.id) return;
        if (matchedAtReceipt && released.journeyId === receivedJourney.id && receivedJourney.phase !== 'ENDED') {
          await this.host?.controller.handle({ kind: 'RECORD_JOURNEY_NAVIGATION', target: received.target,
            context: { contextId: context.id, journeyId: receivedJourney.id,
              continuation: { kind: 'ARRIVAL', sourceHostname: receivedJourney.currentHostname } } });
          context.lastArrival = details.timeStamp;
        } else if (!matchedAtReceipt && (released === null || details.timeStamp >= released.timeStamp)) {
          // A restored document cannot borrow the previous request's authority merely
          // by submitting a new same-host action before reconciliation runs.
          await this.loseJourney(context);
          context.lastArrival = details.timeStamp;
        }
        return;
      }
      const tab = await this.api.tabs.get(details.tabId);
      if (!this.live(context, generation) || tab.url === undefined
        || withoutFragment(tab.url) !== withoutFragment(details.url)) return;
      // Firefox resets per-tab browserAction properties on document navigation.
      // Reapply once after arrival; timer-only publication still deduplicates.
      context.badge = '';
      context.pill = '';
      if (withoutFragment(details.url).split('?', 1)[0] === this.uiUrl) {
        if (context.flight !== null || context.launching) return;
        context.lastArrival = details.timeStamp;
        this.acknowledgeRemoval(context);
        if (context.latest !== null) this.publish(context, context.latest);
        return;
      }
      const observed = destination(details.url);
      if (observed === null) {
        if (/^https?:\/\//i.test(details.url)) {
          this.publish(context, error('INVALID_TARGET'));
          await this.removeContent(context, generation);
          return;
        }
        // Firefox can commit the initial about:blank after the HTTP request is already held.
        // Its arrival must not discard that newer request or the deliberate Journey start.
        if (!context.launching && context.flight === null) {
          context.lastArrival = details.timeStamp;
          context.displayed = null;
          context.displayedDecision = null;
          await this.loseJourney(context);
        }
        return;
      }
      context.lastArrival = details.timeStamp;
      const flight = context.flight;
      const matched = flight !== null && flight.released && flight.url === withoutFragment(details.url)
        && flight.timeStamp <= details.timeStamp;
      // Browser arrival is a fact even while its Core checkpoint is being saved.
      // A document can immediately submit a same-host form during that save; retaining
      // the previous document here would misclassify that action as unrelated.
      context.displayed = observed;
      context.displayedDecision = matched ? flight.authority : null;
      if (context.launching) {
        context.launching = false;
        this.clearRemoval(context);
      }
      context.flight = null;
      if (!matched) await this.loseJourney(context);
      const journey = this.journey(context);
      const active = matched && journey !== null && journey.phase !== 'ENDED' && journey.id === flight.journeyId;
      const continuation: JourneyContinuation | undefined = active
        ? { kind: 'ARRIVAL', sourceHostname: journey.currentHostname } : undefined;
      const result = await this.check(context, observed.target, active, continuation);
      if (!this.live(context, generation)) return;
      this.publish(context, result);
      context.displayedDecision = result.type === 'ADAPTER_ERROR' ? null : result;
      context.requested = observed;
      if (allowed(result)) context.effect = 'NONE';
      this.publishJourney(context);
      this.trace('ARRIVED', context, result, observed.target.hostname);
      if (!allowed(result)) await this.removeContent(context, generation);
    }).catch(() => {
      if (this.live(context, generation)) {
        this.publish(context, error('ARRIVAL_RECONCILIATION_FAILED'));
        void this.run(() => this.removeContent(context, generation));
      }
    });
  };

  private requestFailed = (details: browser.webRequest._OnErrorOccurredDetails): void => {
    if (details.type !== 'main_frame' || details.frameId !== 0) return;
    const context = this.contexts.get(details.tabId);
    const flight = context?.flight;
    if (context === undefined || flight === null || flight === undefined
      || flight.requestId !== details.requestId || flight.url !== withoutFragment(details.url)) return;
    // A denied request also generates an error. Keep its semantic explanation and UI action.
    if (flight.released) {
      context.flight = null;
      this.publish(context, error('NAVIGATION_FAILED'));
      this.trace('FAILED', context);
      void this.refresh();
    }
  };

  private redirected = (details: browser.webRequest._OnBeforeRedirectDetails): void => {
    const context = this.contexts.get(details.tabId);
    if (details.type !== 'main_frame' || details.frameId !== 0 || context?.flight === null
      || context?.flight === undefined || context.flight.requestId !== details.requestId
      || !context.flight.released || context.flight.timeStamp > details.timeStamp
      || context.flight.url !== withoutFragment(details.url)) return;
    context.flight.redirectUrl = withoutFragment(details.redirectUrl);
    this.trace('REDIRECT', context, null, destination(details.redirectUrl)?.target.hostname ?? null);
    // Correlation is evidence for the next held request; Core still decides permission.
  };

  private closed = (tabId: number): void => {
    const context = this.contexts.get(tabId);
    if (context === undefined) return;
    this.contexts.delete(tabId);
    this.clearRemoval(context);
    context.generation++;
    this.trace('CONTEXT_CLOSED', context);
    void this.run(() => this.loseJourney(context));
  };

  private changed = (): void => { void this.refresh(); };
  private updated = (_tabId: number, change: browser.tabs._OnUpdatedChangeInfo): void => {
    if (change.status === 'complete') void this.refresh();
  };
  private toolbar = (tab: browser.tabs.Tab): void => {
    void this.run(async () => {
      const url = `${this.uiUrl}?view=control${tab.id === undefined ? '' : `&tab=${tab.id}`}`;
      const existing = (await this.api.tabs.query({})).find((candidate) =>
        candidate.url?.split(/[?#]/, 1)[0] === this.uiUrl && new URL(candidate.url).searchParams.get('view') !== 'access');
      if (existing?.id !== undefined) await this.api.tabs.update(existing.id, { url, active: true });
      else await this.api.tabs.create({ url, active: true });
    }).catch(() => undefined);
  };

  /** Coalesce timer/lifecycle checks so a slow backend cannot create an unbounded timer queue. */
  refresh(): Promise<void> {
    if (this.refreshPending !== null) return this.refreshPending;
    this.refreshPending = this.run(() => this.recheck()).catch(async () => {
      for (const context of this.contexts.values()) {
        this.publish(context, error('BROWSER_STATE_UNAVAILABLE'));
        await this.removeContent(context, context.generation);
      }
    })
      .finally(() => { this.refreshPending = null; });
    return this.refreshPending;
  }

  private async recheck(): Promise<void> {
    const observation = await this.host?.controller.handle({ kind: 'OBSERVE_TIME' });
    for (const context of this.contexts.values()) {
      if (context.latest !== null) this.publish(context, context.latest);
    }
    const tabs = await this.api.tabs.query({});
    for (const tab of tabs) {
      if (tab.id === undefined || tab.url === undefined || tab.incognito) continue;
      const observed = destination(tab.url);
      const previous = this.contexts.get(tab.id);
      if (withoutFragment(tab.url).split('?', 1)[0] === this.uiUrl) {
        if (previous !== undefined && previous.flight === null && !previous.launching) {
          this.acknowledgeRemoval(previous);
          if (previous.requested !== null) this.publish(previous, await this.check(previous, previous.requested.target));
        }
        continue;
      }
      // Until removal arrives, Firefox may still report the previous document.
      // Keep the denied request's explanation and the original close watchdog.
      // A new held navigation clears REMOVING through the ordinary gate.
      if (previous?.effect === 'REMOVING') continue;
      if (observed === null) {
        if (/^https?:\/\//i.test(tab.url)) {
          const context = previous ?? this.context(tab.id);
          this.publish(context, error('INVALID_TARGET'));
          await this.removeContent(context, context.generation);
        } else if (previous !== undefined && !previous.launching && previous.flight === null) {
          await this.loseJourney(previous);
          previous.displayed = null;
          previous.displayedDecision = null;
        }
        continue;
      }
      const context = previous ?? this.context(tab.id);
      const generation = context.generation;
      if (context.flight !== null || context.launching) {
        const authorities = [context.displayedDecision, context.flight?.authority];
        // A deadline on a previously issued assessment may only veto retention, never grant it.
        // Do not feed the old displayed host into Journey's prospective-hop evaluator.
        const expired = authorities.some((retained) => retained?.type === 'ASSESSMENT' && 'expiresAt' in retained.decision
          && this.now() >= retained.decision.expiresAt);
        const revisionChanged = authorities.some((retained) => retained != null && 'policyRevision' in retained
          && retained.policyRevision !== this.host?.controller.getView().snapshot?.policyRevision);
        if (observation?.type === 'OBSERVED' && !expired && !revisionChanged) continue;
        ++context.generation;
        context.flight = null;
        this.publish(context, error('RECHECK_REQUIRED'));
        await this.loseJourney(context);
        await this.removeContent(context, context.generation);
        continue;
      }
      const journey = this.journey(context);
      if (context.displayed?.target.hostname !== observed.target.hostname
        || (journey !== null && journey.phase !== 'ENDED' && journey.currentHostname !== observed.target.hostname)) {
        await this.loseJourney(context);
      }
      const retained = this.journey(context);
      const result = await this.check(context, observed.target, false,
        retained !== null && retained.phase !== 'ENDED'
          ? { kind: 'RETAINED', sourceHostname: retained.currentHostname } : undefined);
      if (!this.live(context, generation)) continue;
      context.displayed = observed;
      context.displayedDecision = result.type === 'ADAPTER_ERROR' ? null : result;
      this.publish(context, result);
      context.requested = observed;
      if (!allowed(result)) await this.removeContent(context, generation);
    }
  }

  private preparedAccessScope(context: Context): PreparedAccessScope | null {
    const scope = context.accessScope;
    const snapshot = this.host?.controller.getView().snapshot;
    return scope !== null && snapshot !== null && snapshot !== undefined
      && this.live(context, scope.generation) && context.requested?.origin === scope.origin
      && snapshot.policyRevision === scope.policyRevision ? scope : null;
  }

  /** Discovery runs outside the operation queue and can never hold navigation checks. */
  private async prepareAccessScope(tabId: unknown): Promise<unknown> {
    if (!Number.isSafeInteger(tabId)) return { error: 'INVALID_CONTEXT' };
    const prepared = await this.run(async () => {
      const context = this.contexts.get(tabId as number);
      const controller = this.host?.controller;
      if (context?.requested === null || context === undefined || controller === undefined)
        return { error: 'CONTEXT_UNAVAILABLE' };
      const generation = context.generation;
      const result = await this.check(context, context.requested.target);
      if (!this.live(context, generation)) return { error: 'REQUEST_CONTEXT_CHANGED' };
      this.publish(context, result);
      if (result.type !== 'ASSESSMENT' || result.decision.outcome !== 'GREYLIST')
        return { error: 'NOT_GREYLIST' };
      const snapshot = controller.getView().snapshot;
      if (snapshot == null) return { error: 'STORAGE_UNAVAILABLE' };
      const existing = this.preparedAccessScope(context);
      if (existing !== null) return { work: existing.work };
      const aliases = equivalentServiceHostnames(context.requested.target.hostname);
      const hostnames = aliases.filter(host => !snapshot.policy.whitelist.includes(host)
        || snapshot.policy.blacklist.includes(host));
      const discoveryOrigin = canonicalDiscoveryOrigin(context.requested.origin);
      const discover = aliases.length === 1 && discoveryOrigin !== null && this.discoverCanonicalEntry !== undefined;
      const scope: PreparedAccessScope = {
        generation, origin: context.requested.origin, policyRevision: snapshot.policyRevision,
        preview: Object.freeze({ id: `${context.id}:${++this.nextAccessScope}`, status: discover ? 'PREPARING' : 'READY',
          hostnames: Object.freeze(hostnames), source: aliases.length > 1 ? 'DECLARED' : 'EXACT' }),
        work: Promise.resolve(),
      };
      context.accessScope = scope;
      if (discover) {
        // Inspect HTTPS for the same hostname; retain the original browsing origin and binding.
        // A saved path/query is never replayed or passed to discovery.
        scope.work = Promise.resolve().then(() => this.discoverCanonicalEntry!(discoveryOrigin!))
          .catch(() => null).then(partner => this.run(() => {
            if (this.preparedAccessScope(context) !== scope) return;
            const current = controller.getView().snapshot!;
            // Revalidate injected metadata as well as transport's own validation.
            const sanitized = typeof partner === 'string'
              ? canonicalEntryCounterpart(discoveryOrigin!, `https://${partner}/`) : null;
            const counterpart = sanitized === partner ? sanitized : null;
            const members = counterpart === null ? hostnames : [...hostnames, counterpart]
              .filter(host => !current.policy.whitelist.includes(host) || current.policy.blacklist.includes(host));
            scope.preview = Object.freeze({ ...scope.preview, status: 'READY', hostnames: Object.freeze(members),
              source: counterpart === null ? 'EXACT' : 'CANONICAL_REDIRECT' });
          })).then(() => undefined);
      }
      return { work: scope.work };
    });
    if ('work' in prepared) await prepared.work;
    return { ...('error' in prepared ? { error: prepared.error } : {}), view: this.view() };
  }

  view(): AdapterView {
    const controller = this.host?.controller.getView() ?? null;
    return { controller, managed: this.host?.managed?.getView(controller?.snapshot?.policy.whitelist) ?? null,
      temporaryAccess: temporaryAccessView(controller, this.now(), this.host?.managed?.getBlacklist()),
      contexts: [...this.contexts.values()].map((context) => ({ tabId: context.tabId,
        contextId: context.id, navigationId: context.navigationId,
        hostname: context.requested?.target.hostname ?? null,
        displayedHostname: context.displayed?.target.hostname ?? null,
        latest: context.latest, journey: this.journey(context), effect: context.effect,
        retry: journeyRetry(controller, this.journey(context)),
        accessScope: this.preparedAccessScope(context)?.preview ?? null })) };
  }

  private message = (input: unknown, sender: browser.runtime.MessageSender): Promise<unknown> | false => {
    // Closed read-only projection for our top-level content script. No state/UI commands.
    if (sender.id === this.api.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0
      && input !== null && typeof input === 'object' && !Array.isArray(input)
      && Object.keys(input).length === 1 && Object.hasOwn(input, 'kind')
      && (input as { kind?: unknown }).kind === 'GET_JOURNEY_DISPLAY') {
      const context = this.contexts.get(sender.tab.id);
      const observed = sender.url === undefined ? null : destination(sender.url);
      return Promise.resolve({ presentation: context && observed?.target.hostname === context.displayed?.target.hostname
        ? this.pageJourney(context) : null });
    }
    if (sender.id !== this.api.runtime.id || sender.url === undefined
      || sender.url.split(/[?#]/, 1)[0] !== this.uiUrl || (sender.frameId ?? 0) !== 0) return false;
    // A trusted extension page still must use a closed, explicit command shape.
    if (input === null || typeof input !== 'object' || Array.isArray(input)
      || !Object.hasOwn(input, 'kind') || !('kind' in input) || typeof input.kind !== 'string') return Promise.resolve({ error: 'INVALID_COMMAND' });
    const command = input as Record<string, unknown>;
    const keys: Record<string, readonly string[]> = {
      GET_VIEW: [], RECOVER: [], SETUP: ['policy'], OPEN_JOURNEY: ['url'], OPEN_DESTINATION: ['url'],
      START_JOURNEY: ['tabId'], CANCEL_JOURNEY: ['tabId'], START_ACCESS: ['tabId'],
      PREPARE_ACCESS: ['tabId'],
      RESTART_JOURNEY: ['tabId', 'journeyId'],
      CONFIRM_ACCESS: ['requestId'], CANCEL_ACCESS: ['requestId'], OPEN_HOME: ['tabId'],
      CONFIRM_ACCESS_AND_OPEN: ['tabId', 'requestId'], GET_DIAGNOSTICS: ['tabId'], CLEAR_DIAGNOSTICS: [],
      PROPOSE_CURATED_DEFAULTS: [], REVIEW_POLICY: ['proposalId'], CONFIRM_POLICY: ['proposalId'], CANCEL_POLICY: ['proposalId'],
      PROPOSE_SETTINGS: ['candidateConfiguration'], PROPOSE_POLICY: ['candidatePolicy'],
    };
    const fields = command.kind === 'START_ACCESS' && Object.hasOwn(command, 'scopeId')
      ? ['tabId', 'scopeId'] : Object.hasOwn(keys, command.kind as string) ? keys[command.kind as string] : undefined;
    if (fields === undefined || Object.keys(command).length !== fields.length + 1
      || fields.some((field) => !Object.hasOwn(command, field))) return Promise.resolve({ error: 'INVALID_COMMAND' });
    if (command.kind === 'GET_VIEW') return Promise.resolve({ view: this.view() });
    if (command.kind === 'GET_DIAGNOSTICS') return Promise.resolve(command.tabId === null || Number.isSafeInteger(command.tabId)
      ? { entries: this.diagnostics.read(command.tabId as number | null) } : { error: 'INVALID_CONTEXT' });
    if (command.kind === 'CLEAR_DIAGNOSTICS') { this.diagnostics.clear(); return Promise.resolve({ entries: [] }); }
    if (command.kind === 'PREPARE_ACCESS') return this.prepareAccessScope(command.tabId)
      .catch(() => ({ error: 'SCOPE_PREPARATION_FAILED', view: this.view() }));
    return this.run(() => this.command(command)).catch(() => ({ error: 'ADAPTER_FAILURE' }));
  };

  private async command(command: Record<string, unknown>): Promise<unknown> {
    const controller = this.host?.controller;
    if (controller === undefined) return { error: 'STORAGE_UNAVAILABLE', view: this.view() };
    if (command.kind === 'SETUP') {
      const initialized = await this.host!.repository.initialize(command.policy);
      if (initialized) await controller.open();
      return { initialized, view: this.view() };
    }
    if (command.kind === 'RECOVER') {
      await controller.open();
      await this.recheck();
      return { view: this.view() };
    }
    if (command.kind === 'PROPOSE_CURATED_DEFAULTS') {
      // Refresh verified authority before constructing the explicit proposed batch.
      const observed = await controller.handle({ kind: 'OBSERVE_TIME' });
      const policy = controller.getView().snapshot?.policy;
      if (observed.type !== 'OBSERVED' || policy === undefined) return { result: observed, view: this.view() };
      const result = await controller.handle({ kind: 'PROPOSE_POLICY', candidatePolicy: {
        whitelist: [...new Set([...policy.whitelist, ...compileCuratedWhitelist().whitelist])],
        blacklist: policy.blacklist,
      } });
      return { result, view: this.view() };
    }
    if (command.kind === 'REVIEW_POLICY' || command.kind === 'CONFIRM_POLICY' || command.kind === 'CANCEL_POLICY') {
      const result = await controller.handle({ kind: command.kind, proposalId: command.proposalId });
      if (command.kind === 'CONFIRM_POLICY' && result.type === 'COMMITTED') await this.recheck();
      return { result, view: this.view() };
    }
    if (command.kind === 'PROPOSE_SETTINGS' || command.kind === 'PROPOSE_POLICY') {
      const result = await controller.handle(command);
      return { result, view: this.view() };
    }
    let result: Response;
    if (command.kind === 'OPEN_DESTINATION') {
      if (typeof command.url !== 'string' || command.url.length > 4096) return { error: 'INVALID_TARGET' };
      const url = /^https?:\/\//i.test(command.url) ? command.url : `https://${command.url}`;
      const selected = destination(url);
      if (selected === null) return { error: 'INVALID_TARGET' };
      const tab = await this.api.tabs.create({ url: 'about:blank', active: false });
      if (tab.id === undefined) return { error: 'CONTEXT_UNAVAILABLE' };
      const context = this.context(tab.id);
      context.requested = selected;
      this.navigate(context, url);
      void this.api.tabs.update(tab.id, { active: true }).catch(() => undefined);
      return { opened: true, tabId: tab.id, view: this.view() };
    }
    if (command.kind === 'OPEN_JOURNEY') {
      if (typeof command.url !== 'string' || command.url.length > 4096) return { error: 'INVALID_TARGET' };
      const url = /^https?:\/\//i.test(command.url) ? command.url : `https://${command.url}`;
      const selected = destination(url);
      if (selected === null) return { error: 'INVALID_TARGET' };
      const tab = await this.api.tabs.create({ url: 'about:blank', active: false });
      if (tab.id === undefined) return { error: 'CONTEXT_UNAVAILABLE' };
      const context = this.context(tab.id);
      context.requested = selected;
      result = await controller.handle({ kind: 'START_JOURNEY', root: selected.target, contextId: context.id });
      this.trace('COMMAND', context, result);
      this.publish(context, result);
      if (result.type === 'COMMITTED' && this.contexts.get(tab.id) === context) {
        this.navigate(context, url);
        void this.api.tabs.update(tab.id, { active: true }).catch(() => undefined);
      } else await this.api.tabs.remove(tab.id);
      return { result, tabId: tab.id, view: this.view() };
    }
    if (command.kind === 'CONFIRM_ACCESS' || command.kind === 'CANCEL_ACCESS') {
      result = await controller.handle({ kind: command.kind, requestId: command.requestId });
      return { result, view: this.view() };
    }
    if (!Number.isSafeInteger(command.tabId)) return { error: 'INVALID_CONTEXT' };
    const context = this.contexts.get(command.tabId as number);
    if (context === undefined || context.requested === null) return { error: 'CONTEXT_UNAVAILABLE' };
    if (command.kind === 'RESTART_JOURNEY') {
      const retry = journeyRetry(controller.getView(), this.journey(context));
      if (retry === null || retry.journeyId !== command.journeyId) return { error: 'JOURNEY_RETRY_UNAVAILABLE' };
      // Finish removing the previous document before issuing a new browser effect.
      // Its expired authorization must not be retained or used to veto a fresh retry.
      if (context.effect === 'REMOVING') return { error: 'CONTENT_REMOVAL_IN_PROGRESS', opened: false, view: this.view() };
      if (context.launching || context.flight !== null) return { error: 'NAVIGATION_IN_PROGRESS' };
      const generation = context.generation;
      // A fresh current Core assessment/checkpoint must succeed before any browser effect.
      result = await this.check(context, { hostname: retry.rootHostname });
      if (!allowed(result) || result.decision.reason !== 'WHITELISTED' || !this.live(context, generation))
        return { result, opened: false, view: this.view() };
      const origin = context.rootOrigin?.journeyId === retry.journeyId ? context.rootOrigin.origin : `https://${retry.rootHostname}`;
      context.requested = destination(`${origin}/`);
      this.publish(context, result);
      this.navigate(context, `${origin}/`);
      return { opened: true, view: this.view() };
    }
    if (command.kind === 'CONFIRM_ACCESS_AND_OPEN') {
      const pending = controller.getView().snapshot?.accessState.pendingRequests
        .find((request) => request.id === command.requestId);
      if (pending === undefined || !(pending.scopeHostnames ?? [pending.hostname]).includes(context.requested.target.hostname)) return { error: 'REQUEST_CONTEXT_CHANGED', view: this.view() };
      const generation = context.generation;
      const selected = context.requested;
      result = await controller.handle({ kind: 'CONFIRM_ACCESS', requestId: command.requestId });
      this.trace('COMMAND', context, result);
      const opened = result.type === 'COMMITTED' && this.live(context, generation) && context.requested === selected;
      if (opened) this.navigate(context, `${selected.origin}/`);
      return { result, opened, view: this.view() };
    }
    if (command.kind === 'OPEN_HOME') {
      this.navigate(context, `${context.requested.origin}/`);
      return { view: this.view() };
    }
    if (command.kind === 'START_ACCESS') {
      const policy = controller.getView().snapshot?.policy;
      const prepared = this.preparedAccessScope(context);
      let scopeHostnames = prepared?.preview.hostnames ?? equivalentServiceHostnames(context.requested.target.hostname)
        .filter((host) => !policy?.whitelist.includes(host) || policy.blacklist.includes(host));
      if (this.discoverCanonicalEntry !== undefined || Object.hasOwn(command, 'scopeId')) {
        const generation = context.generation;
        const current = await this.check(context, context.requested.target);
        if (!this.live(context, generation)) return { error: 'REQUEST_CONTEXT_CHANGED', view: this.view() };
        this.publish(context, current);
        if (current.type === 'ASSESSMENT'
          && (current.decision.outcome === 'WAIT' || current.decision.outcome === 'REQUIRE_CONFIRMATION')) {
          // Repeated Start refers to the existing request, whose saved terms never change.
          const requestId = current.decision.requestId;
          const pending = controller.getView().snapshot?.accessState.pendingRequests.find(request => request.id === requestId);
          if (pending === undefined) return { error: 'REQUEST_CONTEXT_CHANGED', view: this.view() };
          scopeHostnames = pending.scopeHostnames ?? [pending.hostname];
        } else if (current.type !== 'ASSESSMENT' || current.decision.outcome !== 'GREYLIST'
          || this.preparedAccessScope(context) !== prepared || prepared?.preview.status !== 'READY'
          || command.scopeId !== prepared.preview.id) return { error: 'SCOPE_REVIEW_REQUIRED', view: this.view() };
      }
      result = await controller.handle({ kind: 'START_ACCESS', target: context.requested.target, scopeHostnames });
      if (result.type === 'COMMITTED') context.accessScope = null;
    } else if (command.kind === 'START_JOURNEY') {
      if (context.flight !== null) return { error: 'NAVIGATION_IN_PROGRESS' };
      result = await controller.handle({ kind: 'START_JOURNEY', root: context.requested.target, contextId: context.id });
    } else {
      const journey = this.journey(context);
      if (journey === null) return { error: 'JOURNEY_NOT_FOUND' };
      result = await controller.handle({ kind: 'CANCEL_JOURNEY', journeyId: journey.id, contextId: context.id });
    }
    this.trace('COMMAND', context, result);
    this.publish(context, result);
    if (command.kind === 'CANCEL_JOURNEY') await this.recheck();
    else if (result.type === 'COMMITTED' && this.contexts.get(context.tabId) === context && context.requested !== null)
      this.publish(context, await this.check(context, context.requested.target));
    return { result, view: this.view() };
  }

  private navigate(context: Context, url: string): void {
    // Every resulting HTTP(S) request reenters the blocking gate; no cached ALLOW is replayed.
    const generation = ++context.generation;
    context.flight = null;
    context.launching = true;
    this.clearRemoval(context);
    // This is an effect watchdog, not a policy deadline or a source of permission.
    context.removalTimer = this.schedule(() => {
      if (this.live(context, generation) && context.launching) {
        void this.run(async () => {
          if (!this.live(context, generation) || !context.launching) return;
          this.publish(context, error('NAVIGATION_DID_NOT_START'));
          await this.loseJourney(context);
          await this.removeContent(context, generation);
        });
      }
    }, 10_000);
    void this.api.tabs.update(context.tabId, { url }).catch(() => {
      if (this.live(context, generation)) {
        context.launching = false;
        this.clearRemoval(context);
        this.publish(context, error('NAVIGATION_FAILED'));
        void this.run(() => this.loseJourney(context));
      }
    });
  }

  stop(): void {
    this.stopped = true;
    for (const context of this.contexts.values()) this.clearRemoval(context);
    this.api.webRequest.onBeforeRequest.removeListener(this.beforeRequest);
    this.api.webRequest.onErrorOccurred.removeListener(this.requestFailed);
    this.api.webRequest.onBeforeRedirect.removeListener(this.redirected);
    this.api.webNavigation.onCommitted.removeListener(this.arrived);
    this.api.webNavigation.onHistoryStateUpdated.removeListener(this.changed);
    this.api.webNavigation.onReferenceFragmentUpdated.removeListener(this.changed);
    this.api.tabs.onRemoved.removeListener(this.closed);
    this.api.tabs.onUpdated.removeListener(this.updated);
    this.api.runtime.onMessage.removeListener(this.message);
    this.api.browserAction.onClicked.removeListener(this.toolbar);
  }
}
