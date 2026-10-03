/** Only closed diagnostic codes cross the UI boundary; raw exceptions stay private. */
export class StartupError extends Error {
    stage;
    reason;
    constructor(stage, reason) {
        super(reason);
        this.stage = stage;
        this.reason = reason;
    }
}
export function startupFailure(error) {
    return error instanceof StartupError ? { status: 'FAILED', stage: error.stage, reason: error.reason }
        : { status: 'FAILED', stage: 'STARTUP', reason: 'STARTUP_FAILED' };
}
