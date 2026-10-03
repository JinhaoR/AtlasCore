import { compileCuratedWhitelist } from '../presets/curated-whitelist.js';
/** Development first run only. The repository's atomic guard protects saved authority. */
export async function initializeDevelopmentPolicy(repository) {
    const loaded = await repository.load();
    if (loaded.type === 'UNINITIALIZED')
        await repository.initialize(compileCuratedWhitelist());
}
