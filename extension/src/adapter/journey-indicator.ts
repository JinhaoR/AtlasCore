import type { AtlasControllerView, Journey } from '@atlas/core';
import { serviceLabel } from '../presets/curated-whitelist.js';
import { countdown } from '../ui/presentation.js';

/** A display of verified authority. Never an authorization input. */
export function journeyIndicator(view: AtlasControllerView | null, journey: Journey | null, now: number): string | null {
  journey = view?.snapshot?.journeyState.journeys.find((entry) => entry.id === journey?.id && entry.contextId === journey?.contextId) ?? null;
  if (view?.status !== 'READY' || journey === null || journey.phase === 'ENDED'
    || !Number.isSafeInteger(now) || now < journey.startedAt || now >= journey.expiresAt) return null;
  return `Atlas · Journey → ${serviceLabel(journey.rootHostname)}\n${countdown(journey.expiresAt, now)} remaining`;
}
