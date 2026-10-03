import type { AdapterHost } from '../adapter/firefox-adapter.js';
import { StartupError } from '../adapter/startup-status.js';
import type { InitializableRepository } from '../storage/indexeddb-repository.js';
import type { ManagedBlacklistManager } from '../managed/manager.js';
import { initializeDevelopmentPolicy } from './bootstrap.js';

interface StartupDependencies {
  openRepository(): Promise<InitializableRepository>;
  loadManaged(): Promise<ManagedBlacklistManager>;
  createController(repository: InitializableRepository, managed: ManagedBlacklistManager): AdapterHost['controller'];
}

/** Construct one host attempt. A failed attempt owns and closes its repository. */
export async function createAdapterHost(dependencies: StartupDependencies): Promise<AdapterHost> {
  let repository: InitializableRepository;
  try { repository = await dependencies.openRepository(); }
  catch { throw new StartupError('STORAGE', 'STORAGE_UNAVAILABLE'); }
  try {
    let managed: ManagedBlacklistManager;
    try { managed = await dependencies.loadManaged(); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      throw new StartupError('MANAGED_BLACKLIST', code === 'BUNDLED_BLACKLIST_INVALID' ? code
        : code === 'BUNDLE_UNAVAILABLE' ? code : 'MANAGED_BLACKLIST_UNAVAILABLE');
    }
    try { await initializeDevelopmentPolicy(repository); }
    catch { throw new StartupError('INITIALIZATION', 'INITIALIZATION_FAILED'); }
    try { return { repository, managed, controller: dependencies.createController(repository, managed) }; }
    catch { throw new StartupError('CONTROLLER', 'CONTROLLER_UNAVAILABLE'); }
  } catch (error) {
    try { repository.close(); } catch { /* Preserve the original safe failure. */ }
    throw error;
  }
}
