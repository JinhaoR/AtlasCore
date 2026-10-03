export type StartupStage = 'STORAGE' | 'MANAGED_BLACKLIST' | 'INITIALIZATION' | 'CONTROLLER' | 'STARTUP';
export type StartupReason = 'STORAGE_UNAVAILABLE' | 'BUNDLE_UNAVAILABLE' | 'BUNDLED_BLACKLIST_INVALID'
  | 'MANAGED_BLACKLIST_UNAVAILABLE' | 'INITIALIZATION_FAILED' | 'CONTROLLER_UNAVAILABLE' | 'STARTUP_FAILED';
export type StartupStatus = { readonly status: 'LOADING' | 'READY' }
  | { readonly status: 'FAILED'; readonly stage: StartupStage; readonly reason: StartupReason };

/** Only closed diagnostic codes cross the UI boundary; raw exceptions stay private. */
export class StartupError extends Error {
  constructor(readonly stage: StartupStage, readonly reason: StartupReason) { super(reason); }
}

export function startupFailure(error: unknown): Extract<StartupStatus, { status: 'FAILED' }> {
  return error instanceof StartupError ? { status: 'FAILED', stage: error.stage, reason: error.reason }
    : { status: 'FAILED', stage: 'STARTUP', reason: 'STARTUP_FAILED' };
}
