import type { AtlasControllerView, AtlasControllerFault, Journey, JourneyContinuation } from '@atlas/core';
import type { RepositoryDiagnostics } from '../storage/indexeddb-repository.js';

/** One retained explanation per background lifetime; never authority or a retry instruction. */
export interface AuthorityInterruption {
  readonly status: 'UNAVAILABLE' | 'RECONCILING';
  readonly reason: NonNullable<AtlasControllerView['reason']>;
  readonly observedAt: number | null;
  readonly checkpointAt: number | null;
  /** Latest known storage observation, not proof it caused this interruption. */
  readonly latestStorageFailure: RepositoryDiagnostics['lastFailure'];
  /** Only attached when the fault matches this interruption, never an older unrelated record. */
  readonly internalFault?: AtlasControllerFault;
}

export interface DiagnosticEntry {
  readonly sequence: number;
  readonly at: number | null;
  readonly event: 'REQUEST' | 'REDIRECT' | 'DECISION' | 'RELEASED' | 'ARRIVED' | 'SUPERSEDED'
    | 'FAILED' | 'CONTEXT_CLOSED' | 'COMMAND' | 'CONTENT_REMOVED'
    | 'DOWNLOAD_PREPARED' | 'DOWNLOAD_FETCH' | 'DOWNLOAD_FILE' | 'DOWNLOAD_BLOCKED' | 'DOWNLOAD_FINISHED';
  readonly tabId: number;
  readonly contextId: string;
  readonly navigationId: number;
  readonly hostname: string | null;
  readonly outcome: string | null;
  readonly reason: string | null;
  readonly method: 'GET' | 'POST' | 'OTHER' | null;
  readonly sourceHostname: string | null;
  readonly continuationKind: JourneyContinuation['kind'] | null;
  readonly journey: Pick<Journey, 'id' | 'phase' | 'rootHostname' | 'hopCount' | 'maxHops' | 'expiresAt' | 'endReason'> | null;
}

/** Memory only. Callers supply a closed, hostname-only observation, never browser event objects. */
export class Diagnostics {
  private sequence = 0;
  private entries: DiagnosticEntry[] = [];

  add(entry: Omit<DiagnosticEntry, 'sequence'>): void {
    this.entries.push(structuredClone({ ...entry, sequence: ++this.sequence }));
    if (this.entries.length > 200) this.entries.shift();
  }

  read(tabId: number | null = null): readonly DiagnosticEntry[] {
    return structuredClone(this.entries.filter((entry) => tabId === null || entry.tabId === tabId));
  }

  clear(): void { this.entries = []; }
}
