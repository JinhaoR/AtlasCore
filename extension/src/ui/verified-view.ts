import type { AtlasControllerView } from '@atlas/core';

/** Read-only UI fence around transient housekeeping. No operation is retried here. */
export async function readVerifiedController(query: () => Promise<AtlasControllerView | null>,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 50))): Promise<AtlasControllerView | null> {
  for (let attempt = 0; attempt < 21; attempt++) {
    let view: AtlasControllerView | null;
    try { view = await query(); } catch { return null; }
    if (view?.status === 'READY' && view.snapshot != null) return view;
    if (view == null || !['LOADING', 'COMMITTING'].includes(view.status) || attempt === 20) return null;
    await pause();
  }
  return null;
}
