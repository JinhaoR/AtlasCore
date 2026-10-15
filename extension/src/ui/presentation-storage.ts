/** Presentation writes have no policy authority. Read back a thrown write before reporting its outcome. */
export type PresentationSaveResult = 'SAVED' | 'FAILED' | 'UNCERTAIN';
export function savePresentation(source: Pick<Storage, 'getItem' | 'setItem'> | (() => Pick<Storage, 'getItem' | 'setItem'>), key: string, value: string): PresentationSaveResult {
  let storage: Pick<Storage, 'getItem' | 'setItem'>;
  try { storage = typeof source === 'function' ? source() : source; } catch { return 'UNCERTAIN'; }
  let before: string | null | undefined;
  try { before = storage.getItem(key); } catch { /* A write may still succeed. */ }
  try { storage.setItem(key, value); return 'SAVED'; }
  catch {
    try {
      const after = storage.getItem(key);
      if (after === value) return 'SAVED';
      return before !== undefined && after === before ? 'FAILED' : 'UNCERTAIN';
    } catch { return 'UNCERTAIN'; }
  }
}
