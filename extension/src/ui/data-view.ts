import type { AtlasControllerView } from '@atlas/core';

export type CollectionPhase = 'LOADING' | 'READY' | 'EMPTY' | 'UNAVAILABLE';
/** Transient reads/saves expose acknowledged data; candidates stay private until commit. */
export function hasCommittedCollection(controller: AtlasControllerView | null | undefined): boolean {
  return controller?.snapshot != null && ['READY', 'LOADING', 'COMMITTING'].includes(controller.status);
}
/** Last-verified collections are display-only. Current controller results still govern every action. */
export function collectionPresentation(controller: AtlasControllerView | null | undefined, count: number, attempted: boolean,
  hasLastVerified: boolean): { phase: CollectionPhase; stale: boolean; message: string } {
  if (hasCommittedCollection(controller)) return { phase: count === 0 ? 'EMPTY' : 'READY', stale: false, message: '' };
  const loading = !attempted || controller?.status === 'LOADING' || controller?.status === 'COMMITTING';
  return { phase: loading ? 'LOADING' : 'UNAVAILABLE', stale: hasLastVerified,
    message: `${loading ? 'Loading verified destinations.' : 'Destinations are temporarily unavailable. Retry or open Policy & recovery.'}${hasLastVerified ? ' Showing last verified information; it may be out of date. Browsing actions are unavailable.' : ''}` };
}
