import type { InitializableRepository } from '../storage/indexeddb-repository.js';
import { compileCuratedWhitelist } from '../presets/curated-whitelist.js';

/** Development first run only. The repository's atomic guard protects saved authority. */
export async function initializeDevelopmentPolicy(repository: InitializableRepository): Promise<void> {
  const loaded = await repository.load();
  if (loaded.type === 'UNINITIALIZED') await repository.initialize(compileCuratedWhitelist());
}
