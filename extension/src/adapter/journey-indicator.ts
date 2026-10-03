import { evaluate, type AtlasControllerView, type Journey } from '@atlas/core';
import { serviceLabel } from '../presets/curated-whitelist.js';
import { countdown } from '../ui/presentation.js';

/** A display of verified authority. Never an authorization input. */
export function journeyPresentation(view: AtlasControllerView | null, journey: Journey | null, now: number):
  { journeyId: number; destinationLabel: string; expiresAt: number } | null {
  journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
  // COMMITTING retains the last verified saved snapshot; it is not a candidate permission.
  if ((view?.status !== 'READY' && view?.status !== 'COMMITTING') || journey === null || journey.phase === 'ENDED'
    || journey.policyRevision !== view.snapshot?.policyRevision
    || !Number.isSafeInteger(now) || now < journey.startedAt || now >= journey.expiresAt) return null;
  return { journeyId: journey.id, destinationLabel: serviceLabel(journey.rootHostname), expiresAt: journey.expiresAt };
}

export function journeyIndicator(view: AtlasControllerView | null, journey: Journey | null, now: number): string | null {
  const display = journeyPresentation(view, journey, now);
  return display === null ? null : `Atlas · Journey → ${display.destinationLabel}\n${countdown(display.expiresAt, now)} remaining`;
}

/** Retry copy comes from the latest saved ended record, never from a page's hostname. */
export function journeyRetry(view: AtlasControllerView | null, journey: Journey | null):
  { journeyId: number; rootHostname: string; destinationLabel: string; endReason: Journey['endReason'] } | null {
  journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
  if ((view?.status !== 'READY' && view?.status !== 'COMMITTING') || !view.snapshot || journey === null || journey.phase !== 'ENDED'
    || ['REACHED', 'RETURNED', 'DESTINATION_CHANGED', 'CONTEXT_CLOSED'].includes(journey.endReason!)
    || evaluate(journey.rootHostname, view.snapshot.policy).reason !== 'WHITELISTED') return null;
  return { journeyId: journey.id, rootHostname: journey.rootHostname, destinationLabel: serviceLabel(journey.rootHostname), endReason: journey.endReason };
}
