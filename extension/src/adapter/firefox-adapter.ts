import {
  normalizeTarget, type AtlasController, type AtlasControllerResponse, type AtlasControllerView,
  type AtlasNavigationContext, type Journey, type SiteTarget,
} from '@atlas/core';
import type { InitializableRepository } from '../storage/indexeddb-repository.js';
import { Diagnostics, type DiagnosticEntry } from './diagnostics.js';
import type { ManagedBlacklistManager, ManagedView } from '../managed/manager.js';
import { compileCuratedWhitelist } from '../presets/curated-whitelist.js';

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
}
interface Context {
  tabId: number; id: string; generation: number; flight: Flight | null; launching: boolean;
  requested: Destination | null; displayed: Destination | null;
  displayedDecision: AtlasControllerResponse | null; latest: Response | null;
  effect: 'NONE' | 'REMOVING' | 'REMOVED' | 'FAILED'; removalTimer: number | null;
  lastArrival: number; navigationId: number; badge: string;
}

export interface AdapterView {
  readonly controller: AtlasControllerView | null;
  readonly managed: ManagedView | null;
  readonly contexts: readonly {
    tabId: number; contextId: string; navigationId: number; hostname: string | null; displayedHostname: string | null;
    latest: Response | null; journey: Journey | null; effect: Context['effect'];
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
    const next = this.queue.then(async () => { await this.ready; return work(); });
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
        effect: 'NONE', removalTimer: null, lastArrival: -1, navigationId: 0, badge: '' };
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

  private binding(context: Context): AtlasNavigationContext {
    return { contextId: context.id, journeyId: this.journey(context)?.id ?? null };
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
        journey: journey === null ? null : { id: journey.id, phase: journey.phase,
          rootHostname: journey.rootHostname, hopCount: journey.hopCount,
          maxHops: journey.maxHops, expiresAt: journey.expiresAt } });
    } catch { /* Observability failure cannot release or cancel a navigation. */ }
  }

  private publish(context: Context, result: Response): void {
    const signature = (response: Response | null) => response?.type === 'ASSESSMENT'
      ? JSON.stringify(response.decision) : JSON.stringify(response);
    if (signature(context.latest) !== signature(result)) this.trace('DECISION', context, result);
    context.latest = result;
    const decision = result.type === 'ASSESSMENT' ? result.decision : null;
    const journey = this.journey(context);
    const text = decision?.outcome === 'ALLOW' ? journey !== null && journey.phase !== 'ENDED' ? 'J' : ''
      : decision?.outcome === 'WAIT' ? 'WAIT' : decision?.outcome === 'REQUIRE_CONFIRMATION' ? 'GO' : '!';
    const title = `Atlas · ${decision?.outcome ?? result.type} · ${decision?.reason ?? ('reason' in result ? result.reason : '')}`;
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

  private async check(context: Context, target: SiteTarget, record = false): Promise<Response> {
    return this.host?.controller.handle({ kind: record ? 'RECORD_JOURNEY_NAVIGATION' : 'CHECK_NAVIGATION',
      target, context: this.binding(context) }) ?? error('STORAGE_UNAVAILABLE');
  }

  private async loseJourney(context: Context): Promise<void> {
    const journey = this.journey(context);
    if (journey !== null && journey.phase !== 'ENDED') {
      await this.host?.controller.handle({ kind: 'CLOSE_JOURNEY_CONTEXT',
        contextId: context.id, journeyId: journey.id });
      this.trace('CONTEXT_CLOSED', context);
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
    if (context.flight !== null && (!context.flight.released || context.flight.requestId !== details.requestId))
      this.trace('SUPERSEDED', context);
    const generation = ++context.generation;
    context.navigationId = ++this.nextNavigation;
    context.launching = false;
    this.clearRemoval(context);
    context.effect = 'NONE';
    const flight: Flight = { requestId: details.requestId, url: withoutFragment(details.url),
      timeStamp: details.timeStamp, destination: destination(details.url), released: false, journeyId: null, authority: null };
    context.flight = flight;
    context.requested = flight.destination;
    this.trace('REQUEST', context, null);
    // Invalidate earlier work before joining the queue, including a result waiting on a save.
    return this.run(async () => {
      if (!this.live(context, generation)) return { cancel: true };
      let result: Response = flight.destination === null ? error('INVALID_TARGET')
        : await this.check(context, flight.destination.target);
      if (!this.live(context, generation)) return { cancel: true };
      const journey = this.journey(context);
      flight.journeyId = journey?.id ?? null;
      if (allowed(result) && journey !== null && journey.phase !== 'ENDED'
        && flight.destination!.target.hostname !== journey.rootHostname) {
        result = await this.check(context, flight.destination!.target, true);
      }
      if (!this.live(context, generation)) return { cancel: true };
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
    void this.run(async () => {
      if (!this.live(context, generation) || details.timeStamp <= context.lastArrival) return;
      const tab = await this.api.tabs.get(details.tabId);
      if (!this.live(context, generation) || tab.url === undefined
        || withoutFragment(tab.url) !== withoutFragment(details.url)) return;
      if (withoutFragment(details.url).split('?', 1)[0] === this.uiUrl) {
        if (context.flight !== null || context.launching) return;
        context.lastArrival = details.timeStamp;
        this.acknowledgeRemoval(context);
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
        if (!context.launching && context.flight === null) await this.loseJourney(context);
        return;
      }
      context.lastArrival = details.timeStamp;
      const flight = context.flight;
      const matched = flight !== null && flight.released && flight.url === withoutFragment(details.url)
        && flight.timeStamp <= details.timeStamp;
      context.flight = null;
      if (!matched) await this.loseJourney(context);
      const journey = this.journey(context);
      const recordReturn = matched && journey !== null && journey.phase !== 'ENDED'
        && journey.id === flight.journeyId && observed.target.hostname === journey.rootHostname;
      const result = await this.check(context, observed.target, recordReturn);
      if (!this.live(context, generation)) return;
      this.publish(context, result);
      context.displayed = observed;
      context.displayedDecision = result.type === 'ADAPTER_ERROR' ? null : result;
      context.requested = observed;
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
      || context.flight.url !== withoutFragment(details.url)) return;
    this.trace('REDIRECT', context, null, destination(details.redirectUrl)?.target.hostname ?? null);
    // Observation only: the next onBeforeRequest must independently pass Core's gate.
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
      const result = await this.check(context, observed.target);
      if (!this.live(context, generation)) continue;
      context.displayed = observed;
      context.displayedDecision = result.type === 'ADAPTER_ERROR' ? null : result;
      this.publish(context, result);
      context.requested = observed;
      if (!allowed(result)) await this.removeContent(context, generation);
    }
  }

  view(): AdapterView {
    const controller = this.host?.controller.getView() ?? null;
    return { controller, managed: this.host?.managed?.getView(controller?.snapshot?.policy.whitelist) ?? null,
      contexts: [...this.contexts.values()].map((context) => ({ tabId: context.tabId,
        contextId: context.id, navigationId: context.navigationId,
        hostname: context.requested?.target.hostname ?? null,
        displayedHostname: context.displayed?.target.hostname ?? null,
        latest: context.latest, journey: this.journey(context), effect: context.effect })) };
  }

  private message = (input: unknown, sender: browser.runtime.MessageSender): Promise<unknown> | false => {
    if (sender.id !== this.api.runtime.id || sender.url === undefined
      || sender.url.split(/[?#]/, 1)[0] !== this.uiUrl || (sender.frameId ?? 0) !== 0) return false;
    // A trusted extension page still must use a closed, explicit command shape.
    if (input === null || typeof input !== 'object' || Array.isArray(input)
      || !Object.hasOwn(input, 'kind') || !('kind' in input) || typeof input.kind !== 'string') return Promise.resolve({ error: 'INVALID_COMMAND' });
    const command = input as Record<string, unknown>;
    const keys: Record<string, readonly string[]> = {
      GET_VIEW: [], RECOVER: [], SETUP: ['policy'], OPEN_JOURNEY: ['url'],
      START_JOURNEY: ['tabId'], CANCEL_JOURNEY: ['tabId'], START_ACCESS: ['tabId'],
      CONFIRM_ACCESS: ['requestId'], CANCEL_ACCESS: ['requestId'], OPEN_HOME: ['tabId'],
      CONFIRM_ACCESS_AND_OPEN: ['tabId', 'requestId'], GET_DIAGNOSTICS: ['tabId'], CLEAR_DIAGNOSTICS: [],
      PROPOSE_CURATED_DEFAULTS: [], REVIEW_POLICY: ['proposalId'], CONFIRM_POLICY: ['proposalId'], CANCEL_POLICY: ['proposalId'],
    };
    const fields = Object.hasOwn(keys, command.kind as string) ? keys[command.kind as string] : undefined;
    if (fields === undefined || Object.keys(command).length !== fields.length + 1
      || fields.some((field) => !Object.hasOwn(command, field))) return Promise.resolve({ error: 'INVALID_COMMAND' });
    if (command.kind === 'GET_VIEW') return Promise.resolve({ view: this.view() });
    if (command.kind === 'GET_DIAGNOSTICS') return Promise.resolve(command.tabId === null || Number.isSafeInteger(command.tabId)
      ? { entries: this.diagnostics.read(command.tabId as number | null) } : { error: 'INVALID_CONTEXT' });
    if (command.kind === 'CLEAR_DIAGNOSTICS') { this.diagnostics.clear(); return Promise.resolve({ entries: [] }); }
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
    let result: Response;
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
    if (command.kind === 'CONFIRM_ACCESS_AND_OPEN') {
      const pending = controller.getView().snapshot?.accessState.pendingRequests
        .find((request) => request.id === command.requestId);
      if (pending?.hostname !== context.requested.target.hostname) return { error: 'REQUEST_CONTEXT_CHANGED', view: this.view() };
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
      result = await controller.handle({ kind: 'START_ACCESS', target: context.requested.target });
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
