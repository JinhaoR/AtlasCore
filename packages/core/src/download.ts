import type { AtlasNavigationContext, AtlasNavigationDecision } from './atlas-models.js';
import type { SiteTarget } from './models.js';
import { nonnegativeInteger } from './access-state.js';
import { hasJourneyFields, validContextId } from './journey-state.js';
import { normalizeTarget } from './target.js';

export const DOWNLOAD_LIFETIME_MS = 30_000;
export const DOWNLOAD_MAX_REDIRECTS = 5;

/** Ephemeral owner-held state, never a hostname grant or a persisted bearer token. */
export interface DownloadIntent {
  readonly operationId: string;
  readonly contextId: string;
  readonly sourceContextId: string;
  readonly sourceJourneyId: number | null;
  readonly sourceHostname: string;
  readonly currentHostname: string;
  readonly policyRevision: number;
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly lastObservedAt: number;
  readonly redirects: number;
  readonly phase: 'PREPARED' | 'REQUESTING' | 'FINISHED';
}
export interface DownloadOperation {
  readonly kind: 'CHECK_DOWNLOAD';
  readonly stage: 'PREPARE' | 'REQUEST' | 'REDIRECT' | 'CHECK' | 'ATTACHMENT';
  readonly source: { readonly target: SiteTarget; readonly context: Pick<AtlasNavigationContext, 'contextId' | 'journeyId'> };
  readonly target: SiteTarget;
  readonly binding: { readonly operationId: string; readonly contextId: string };
  readonly intent: DownloadIntent | null;
}
export type DownloadResult = {
  readonly type: 'DOWNLOAD';
  readonly outcome: 'PREPARED' | 'FETCH' | 'FILE';
  readonly intent: DownloadIntent;
} | {
  readonly type: 'DOWNLOAD'; readonly outcome: 'DENY';
  readonly reason: 'INVALID_DOWNLOAD' | 'DOWNLOAD_EXPIRED' | 'DOWNLOAD_POLICY_CHANGED'
    | 'DOWNLOAD_SCOPE_MISMATCH' | 'DOWNLOAD_CONSUMED' | 'DOWNLOAD_REDIRECT_LIMIT'
    | 'DOWNLOAD_SOURCE_UNAUTHORIZED' | 'BLACKLISTED' | 'MANAGED_BLACKLISTED';
};

const host = (input: unknown): input is string => typeof input === 'string'
  && normalizeTarget({ hostname: input })?.hostname === input;
const journeyId = (input: unknown): input is number | null => input === null
  || nonnegativeInteger(input) && input > 0;

export function readDownloadIntent(value: unknown): DownloadIntent | null {
  if (!hasJourneyFields(value, ['operationId', 'contextId', 'sourceContextId', 'sourceJourneyId', 'sourceHostname',
    'currentHostname', 'policyRevision', 'startedAt', 'expiresAt', 'lastObservedAt', 'redirects', 'phase'])
    || !validContextId(value.operationId) || !validContextId(value.contextId) || !validContextId(value.sourceContextId)
    || !journeyId(value.sourceJourneyId) || !host(value.sourceHostname) || !host(value.currentHostname)
    || !nonnegativeInteger(value.policyRevision) || !nonnegativeInteger(value.startedAt)
    || !nonnegativeInteger(value.expiresAt) || !nonnegativeInteger(value.lastObservedAt)
    || value.expiresAt <= value.startedAt || value.expiresAt - value.startedAt > DOWNLOAD_LIFETIME_MS
    || value.lastObservedAt < value.startedAt || value.lastObservedAt >= value.expiresAt
    || !nonnegativeInteger(value.redirects) || value.redirects > DOWNLOAD_MAX_REDIRECTS
    || !['PREPARED', 'REQUESTING', 'FINISHED'].includes(value.phase as string)
    || value.phase === 'PREPARED' && value.redirects !== 0) return null;
  return { ...value } as unknown as DownloadIntent;
}

export function readDownloadOperation(value: unknown): DownloadOperation | null {
  if (!hasJourneyFields(value, ['kind', 'stage', 'source', 'target', 'binding', 'intent'])
    || value.kind !== 'CHECK_DOWNLOAD' || !['PREPARE', 'REQUEST', 'REDIRECT', 'CHECK', 'ATTACHMENT'].includes(value.stage as string)
    || !hasJourneyFields(value.source, ['target', 'context'])
    || !hasJourneyFields(value.source.target, ['hostname']) || !host(value.source.target.hostname)
    || !hasJourneyFields(value.source.context, ['contextId', 'journeyId'])
    || !validContextId(value.source.context.contextId) || !journeyId(value.source.context.journeyId)
    || !hasJourneyFields(value.target, ['hostname']) || !host(value.target.hostname)
    || !hasJourneyFields(value.binding, ['operationId', 'contextId'])
    || !validContextId(value.binding.operationId) || !validContextId(value.binding.contextId)) return null;
  const intent = value.intent === null ? null : readDownloadIntent(value.intent);
  if (value.intent !== null && intent === null || (value.stage === 'PREPARE') !== (intent === null)) return null;
  return { kind: 'CHECK_DOWNLOAD', stage: value.stage as DownloadOperation['stage'],
    source: { target: { hostname: value.source.target.hostname },
      context: { contextId: value.source.context.contextId, journeyId: value.source.context.journeyId } },
    target: { hostname: value.target.hostname },
    binding: { operationId: value.binding.operationId, contextId: value.binding.contextId }, intent };
}

/** Called only after complete planner validation and current policy/source assessment. */
export function evaluateDownload(operation: DownloadOperation, source: AtlasNavigationDecision | null,
  target: AtlasNavigationDecision, revision: number, now: number): DownloadResult {
  const deny = (reason: Extract<DownloadResult, { outcome: 'DENY' }>['reason']): DownloadResult =>
    ({ type: 'DOWNLOAD', outcome: 'DENY', reason });
  if (target.outcome === 'DENY') return deny(target.reason === 'BLACKLISTED' || target.reason === 'MANAGED_BLACKLISTED'
    ? target.reason : 'INVALID_DOWNLOAD');
  if (source?.outcome !== 'ALLOW') return deny('DOWNLOAD_SOURCE_UNAUTHORIZED');
  const prior = operation.intent;
  if (prior === null) {
    const expiresAt = Math.min(now + DOWNLOAD_LIFETIME_MS, 'expiresAt' in source ? source.expiresAt : Infinity);
    if (!nonnegativeInteger(expiresAt) || expiresAt <= now) return deny('INVALID_DOWNLOAD');
    return { type: 'DOWNLOAD', outcome: 'PREPARED', intent: { ...operation.binding,
      sourceContextId: operation.source.context.contextId, sourceJourneyId: operation.source.context.journeyId,
      sourceHostname: operation.source.target.hostname, currentHostname: operation.target.hostname,
      policyRevision: revision, startedAt: now, expiresAt, lastObservedAt: now, redirects: 0, phase: 'PREPARED' } };
  }
  if (prior.policyRevision !== revision) return deny('DOWNLOAD_POLICY_CHANGED');
  if (now < prior.lastObservedAt) return deny('INVALID_DOWNLOAD');
  if (now >= prior.expiresAt) return deny('DOWNLOAD_EXPIRED');
  if (prior.operationId !== operation.binding.operationId || prior.contextId !== operation.binding.contextId
    || prior.sourceContextId !== operation.source.context.contextId || prior.sourceJourneyId !== operation.source.context.journeyId
    || prior.sourceHostname !== operation.source.target.hostname
    || operation.stage !== 'REDIRECT' && prior.currentHostname !== operation.target.hostname) return deny('DOWNLOAD_SCOPE_MISMATCH');
  if (prior.phase === 'FINISHED') return deny('DOWNLOAD_CONSUMED');
  if (operation.stage === 'REQUEST' ? prior.phase !== 'PREPARED' : prior.phase !== 'REQUESTING') return deny('INVALID_DOWNLOAD');
  if (operation.stage === 'REDIRECT' && prior.redirects >= DOWNLOAD_MAX_REDIRECTS) return deny('DOWNLOAD_REDIRECT_LIMIT');
  return { type: 'DOWNLOAD', outcome: operation.stage === 'ATTACHMENT' ? 'FILE' : 'FETCH', intent: {
    ...prior, currentHostname: operation.target.hostname, lastObservedAt: now,
    redirects: prior.redirects + (operation.stage === 'REDIRECT' ? 1 : 0),
    phase: operation.stage === 'ATTACHMENT' ? 'FINISHED' : 'REQUESTING',
  } };
}
