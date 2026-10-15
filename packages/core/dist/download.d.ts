import type { AtlasNavigationContext, AtlasNavigationDecision } from './atlas-models.js';
import type { SiteTarget } from './models.js';
export declare const DOWNLOAD_LIFETIME_MS = 30000;
export declare const DOWNLOAD_MAX_REDIRECTS = 5;
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
    readonly source: {
        readonly target: SiteTarget;
        readonly context: Pick<AtlasNavigationContext, 'contextId' | 'journeyId'>;
    };
    readonly target: SiteTarget;
    readonly binding: {
        readonly operationId: string;
        readonly contextId: string;
    };
    readonly intent: DownloadIntent | null;
}
export type DownloadResult = {
    readonly type: 'DOWNLOAD';
    readonly outcome: 'PREPARED' | 'FETCH' | 'FILE';
    readonly intent: DownloadIntent;
} | {
    readonly type: 'DOWNLOAD';
    readonly outcome: 'DENY';
    readonly reason: 'INVALID_DOWNLOAD' | 'DOWNLOAD_EXPIRED' | 'DOWNLOAD_POLICY_CHANGED' | 'DOWNLOAD_SCOPE_MISMATCH' | 'DOWNLOAD_CONSUMED' | 'DOWNLOAD_REDIRECT_LIMIT' | 'DOWNLOAD_SOURCE_UNAUTHORIZED' | 'BLACKLISTED' | 'MANAGED_BLACKLISTED';
};
export declare function readDownloadIntent(value: unknown): DownloadIntent | null;
export declare function readDownloadOperation(value: unknown): DownloadOperation | null;
/** Called only after complete planner validation and current policy/source assessment. */
export declare function evaluateDownload(operation: DownloadOperation, source: AtlasNavigationDecision | null, target: AtlasNavigationDecision, revision: number, now: number): DownloadResult;
