import { StartupError } from '../adapter/startup-status.js';
import { initializeDevelopmentPolicy } from './bootstrap.js';
/** Construct one host attempt. A failed attempt owns and closes its repository. */
export async function createAdapterHost(dependencies) {
    let repository;
    try {
        repository = await dependencies.openRepository();
    }
    catch {
        throw new StartupError('STORAGE', 'STORAGE_UNAVAILABLE');
    }
    try {
        let managed;
        try {
            managed = await dependencies.loadManaged();
        }
        catch (error) {
            const code = error instanceof Error ? error.message : '';
            throw new StartupError('MANAGED_BLACKLIST', code === 'BUNDLED_BLACKLIST_INVALID' ? code
                : code === 'BUNDLE_UNAVAILABLE' ? code : 'MANAGED_BLACKLIST_UNAVAILABLE');
        }
        try {
            await initializeDevelopmentPolicy(repository);
        }
        catch {
            throw new StartupError('INITIALIZATION', 'INITIALIZATION_FAILED');
        }
        try {
            return { repository, managed, controller: dependencies.createController(repository, managed) };
        }
        catch {
            throw new StartupError('CONTROLLER', 'CONTROLLER_UNAVAILABLE');
        }
    }
    catch (error) {
        try {
            repository.close();
        }
        catch { /* Preserve the original safe failure. */ }
        throw error;
    }
}
