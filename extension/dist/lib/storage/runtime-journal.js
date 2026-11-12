const key = 'atlas-runtime-diagnostic-v1';
const errors = new Set(['ERROR', 'TYPE_ERROR', 'RANGE_ERROR', 'SYNTAX_ERROR', 'INTERNAL_ERROR', 'DATA_CLONE_ERROR', 'OTHER', 'ABORT_ERROR', 'INVALID_STATE_ERROR', 'QUOTA_EXCEEDED_ERROR']);
const subsystems = new Set(['CONTROLLER', 'ADAPTER_QUEUE', 'VIEW', 'BACKGROUND_ERROR', 'UNHANDLED_REJECTION']);
const stages = new Set(['START', 'LOAD', 'VALIDATE_LOAD', 'VERIFY_AUTHORITY', 'CLOCK', 'MANAGED_POLICY', 'PLAN', 'PLAN_RECOVERY', 'COMPARE_PLAN', 'VALIDATE_COMMIT', 'PREPARE_COMMIT', 'COMMIT', 'RESOLVE_COMMIT', 'PUBLISH']);
const operations = new Set(['OPEN', 'INVALID_OPERATION', 'BEGIN_NAVIGATION', 'CHECK_NAVIGATION', 'RECORD_JOURNEY_NAVIGATION',
    'START_ACCESS', 'CONFIRM_ACCESS', 'CANCEL_ACCESS', 'END_ACCESS', 'START_JOURNEY', 'CANCEL_JOURNEY', 'CLOSE_JOURNEY_CONTEXT', 'PROPOSE_POLICY',
    'PROPOSE_SETTINGS', 'REVIEW_POLICY', 'CONFIRM_POLICY', 'CANCEL_POLICY', 'OBSERVE_TIME', 'CHECK_DOWNLOAD', 'REMOVE_WHITELIST']);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const time = (n) => n === null || integer(n);
const object = (n) => n !== null && typeof n === 'object' && !Array.isArray(n);
/** Saved diagnostics are untrusted display data. Reconstruct only bounded closed
 * fields; never restore authority, timers, navigation history or raw exception data. */
export function readRuntimeSession(value) {
    try {
        if (!object(value) || value.format !== 1 || typeof value.version !== 'string' || !/^\d{1,5}(\.\d{1,5}){1,3}$/.test(value.version)
            || !time(value.startedAt) || !Array.isArray(value.faults) || value.faults.length > 20)
            return null;
        const faults = [];
        for (const f of value.faults) {
            if (!object(f) || !integer(f.sequence) || !integer(f.count) || f.count < 1 || !time(f.firstAt) || !time(f.lastAt)
                || typeof f.subsystem !== 'string' || !subsystems.has(f.subsystem) || typeof f.error !== 'string' || !errors.has(f.error)
                || !Array.isArray(f.frames) || f.frames.length > 5)
                return null;
            const frames = [];
            for (const frame of f.frames) {
                if (!object(frame) || frame.asset !== 'BACKGROUND' || !integer(frame.line) || frame.line < 1 || frame.line > 9999999
                    || !integer(frame.column) || frame.column < 1 || frame.column > 9999999)
                    return null;
                frames.push({ asset: 'BACKGROUND', line: frame.line, column: frame.column });
            }
            let controller = null;
            if (f.controller !== null) {
                const c = f.controller;
                if (!object(c) || !integer(c.sequence) || typeof c.operation !== 'string' || !operations.has(c.operation)
                    || typeof c.stage !== 'string' || !stages.has(c.stage))
                    return null;
                controller = { sequence: c.sequence, operation: c.operation, stage: c.stage };
            }
            faults.push({ sequence: f.sequence, count: f.count, firstAt: f.firstAt, lastAt: f.lastAt, frames, controller,
                subsystem: f.subsystem, error: f.error });
        }
        return { version: value.version, startedAt: value.startedAt, faults };
    }
    catch {
        return null;
    }
}
export function runtimeJournal(storage) {
    return {
        async load() {
            const value = storage().getItem(key);
            if (value === null)
                return null;
            const parsed = readRuntimeSession(JSON.parse(value));
            if (!parsed)
                throw new Error('DIAGNOSTIC_DATA_INVALID');
            return parsed;
        },
        async save(session) {
            const safe = readRuntimeSession({ format: 1, ...session });
            if (!safe)
                return false;
            try {
                storage().setItem(key, JSON.stringify({ format: 1, ...safe }));
                return true;
            }
            catch {
                return false;
            }
        },
    };
}
