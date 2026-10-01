import type { Journey } from '@atlas/core';

export interface DiagnosticEntry {
  readonly sequence: number;
  readonly at: number | null;
  readonly event: 'REQUEST' | 'REDIRECT' | 'DECISION' | 'RELEASED' | 'ARRIVED' | 'SUPERSEDED'
    | 'FAILED' | 'CONTEXT_CLOSED' | 'COMMAND' | 'CONTENT_REMOVED';
  readonly tabId: number;
  readonly contextId: string;
  readonly navigationId: number;
  readonly hostname: string | null;
  readonly outcome: string | null;
  readonly reason: string | null;
  readonly journey: Pick<Journey, 'id' | 'phase' | 'rootHostname' | 'hopCount' | 'maxHops' | 'expiresAt'> | null;
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
