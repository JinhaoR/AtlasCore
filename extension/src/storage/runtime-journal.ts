import type { RuntimeFault, RuntimeJournal, RuntimeSession } from '../adapter/runtime-diagnostics.js';

const key = 'atlas-runtime-diagnostic-v1';
const errors = new Set(['ERROR','TYPE_ERROR','RANGE_ERROR','SYNTAX_ERROR','INTERNAL_ERROR','DATA_CLONE_ERROR','OTHER','ABORT_ERROR','INVALID_STATE_ERROR','QUOTA_EXCEEDED_ERROR']);
const subsystems = new Set(['CONTROLLER','ADAPTER_QUEUE','VIEW','BACKGROUND_ERROR','UNHANDLED_REJECTION']);
const stages = new Set(['START','LOAD','VALIDATE_LOAD','VERIFY_AUTHORITY','CLOCK','MANAGED_POLICY','PLAN','PLAN_RECOVERY','COMPARE_PLAN','VALIDATE_COMMIT','PREPARE_COMMIT','COMMIT','RESOLVE_COMMIT','PUBLISH']);
const operations = new Set(['OPEN','INVALID_OPERATION','BEGIN_NAVIGATION','CHECK_NAVIGATION','RECORD_JOURNEY_NAVIGATION',
  'START_ACCESS','CONFIRM_ACCESS','CANCEL_ACCESS','END_ACCESS','START_JOURNEY','CANCEL_JOURNEY','CLOSE_JOURNEY_CONTEXT','PROPOSE_POLICY',
  'PROPOSE_SETTINGS','REVIEW_POLICY','CONFIRM_POLICY','CANCEL_POLICY','OBSERVE_TIME','CHECK_DOWNLOAD','REMOVE_WHITELIST']);
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const time = (n: unknown): n is number | null => n === null || integer(n);
const object = (n: unknown): n is Record<string, unknown> => n !== null && typeof n === 'object' && !Array.isArray(n);

/** Saved diagnostics are untrusted display data. Reconstruct only bounded closed
 * fields; never restore authority, timers, navigation history or raw exception data. */
export function readRuntimeSession(value: unknown): RuntimeSession | null {
  try {
    if (!object(value) || value.format !== 1 || typeof value.version !== 'string' || !/^\d{1,5}(\.\d{1,5}){1,3}$/.test(value.version)
      || !time(value.startedAt) || !Array.isArray(value.faults) || value.faults.length > 20) return null;
    const faults: RuntimeFault[] = [];
    for (const f of value.faults) {
      if (!object(f) || !integer(f.sequence) || !integer(f.count) || f.count < 1 || !time(f.firstAt) || !time(f.lastAt)
        || typeof f.subsystem !== 'string' || !subsystems.has(f.subsystem) || typeof f.error !== 'string' || !errors.has(f.error)
        || !Array.isArray(f.frames) || f.frames.length > 5) return null;
      const frames: RuntimeFault['frames'][number][] = [];
      for (const frame of f.frames) {
        if (!object(frame) || frame.asset !== 'BACKGROUND' || !integer(frame.line) || frame.line < 1 || frame.line > 9999999
          || !integer(frame.column) || frame.column < 1 || frame.column > 9999999) return null;
        frames.push({ asset: 'BACKGROUND', line: frame.line, column: frame.column });
      }
      let controller: RuntimeFault['controller'] = null;
      if (f.controller !== null) {
        const c = f.controller;
        if (!object(c) || !integer(c.sequence) || typeof c.operation !== 'string' || !operations.has(c.operation)
          || typeof c.stage !== 'string' || !stages.has(c.stage)) return null;
        controller = { sequence: c.sequence, operation: c.operation as NonNullable<RuntimeFault['controller']>['operation'], stage: c.stage as NonNullable<RuntimeFault['controller']>['stage'] };
      }
      faults.push({ sequence: f.sequence, count: f.count, firstAt: f.firstAt, lastAt: f.lastAt, frames, controller,
        subsystem: f.subsystem as RuntimeFault['subsystem'], error: f.error as RuntimeFault['error'] });
    }
    return { version: value.version, startedAt: value.startedAt, faults };
  } catch { return null; }
}

export function runtimeJournal(storage: () => Pick<Storage, 'getItem' | 'setItem'>): RuntimeJournal {
  return {
    async load() {
      const value = storage().getItem(key);
      if (value === null) return null;
      const parsed = readRuntimeSession(JSON.parse(value));
      if (!parsed) throw new Error('DIAGNOSTIC_DATA_INVALID');
      return parsed;
    },
    async save(session) {
      const safe = readRuntimeSession({ format: 1, ...session });
      if (!safe) return false;
      try { storage().setItem(key, JSON.stringify({ format: 1, ...safe })); return true; } catch { return false; }
    },
  };
}
