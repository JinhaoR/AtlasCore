import type { AtlasConfiguration, AtlasError, AtlasNavigationDecision, AtlasOperation, AtlasSnapshot } from "./atlas-models.js";
import type { AtlasClock, AtlasRepository } from "./atlas-ports.js";
import type { PolicyReview } from "./vault-models.js";
import type { ManagedBlacklist } from "./managed-blacklist.js";
import type { DownloadResult } from './download.js';

export type AtlasControllerStatus =
  | "UNINITIALIZED" | "LOADING" | "READY" | "COMMITTING" | "RECONCILING" | "UNAVAILABLE";

export type AtlasControllerError =
  | "NOT_OPEN" | "NOT_READY" | "UNINITIALIZED" | "STORAGE_UNAVAILABLE" | "CORRUPT_STATE"
  | "STORAGE_ROLLBACK" | "WRITE_FAILED" | "STORAGE_CONFLICT" | "COMMIT_UNKNOWN"
  | "AUTHORITY_CHANGED" | "CLOCK_UNAVAILABLE" | "INVALID_TIME" | "CLOCK_ROLLBACK"
  | "REEVALUATION_REQUIRED" | "ID_EXHAUSTED" | "INTERNAL_ERROR" | "MANAGED_BLACKLIST_UNAVAILABLE";

/** Closed, memory-only explanation. No exception text, stack, hostnames or state payload. */
export interface AtlasControllerFault {
  readonly sequence: number;
  readonly operation: AtlasOperation['kind'] | 'OPEN' | 'INVALID_OPERATION';
  readonly stage: 'START' | 'LOAD' | 'VALIDATE_LOAD' | 'VERIFY_AUTHORITY' | 'CLOCK' | 'MANAGED_POLICY'
    | 'PLAN' | 'PLAN_RECOVERY' | 'COMPARE_PLAN' | 'VALIDATE_COMMIT' | 'PREPARE_COMMIT'
    | 'COMMIT' | 'RESOLVE_COMMIT' | 'PUBLISH';
  readonly error: 'ERROR' | 'TYPE_ERROR' | 'RANGE_ERROR' | 'SYNTAX_ERROR' | 'INTERNAL_ERROR' | 'DATA_CLONE_ERROR' | 'OTHER';
  readonly pendingCommitId: string | null;
  /** Counts from the last verified authority, not a newly authorized snapshot. */
  readonly stateCounts: { readonly journeys: number; readonly requests: number; readonly grants: number } | null;
}

export interface AtlasControllerView {
  readonly status: AtlasControllerStatus;
  readonly reason: AtlasControllerError | null;
  /** Last verified data, not authority to execute. May be stale when status is not READY. */
  readonly snapshot: AtlasSnapshot | null;
  readonly storageVersion: string | null;
  readonly pendingCommitId: string | null;
  /** Retained across explicit recovery in the same owner. Never a recovery instruction. */
  readonly internalFault?: AtlasControllerFault;
}

interface ResultVersion {
  readonly policyRevision: number;
  readonly storageVersion: string;
  readonly observedAt: number;
}

export type AtlasControllerResponse =
  | { readonly type: "BLOCKED"; readonly reason: AtlasControllerError;
    readonly status: AtlasControllerStatus; readonly pendingCommitId: string | null }
  | (ResultVersion & (
    | DownloadResult
    | { readonly type: "COMMITTED"; readonly operation: AtlasOperation["kind"]; readonly referenceId: number }
    | { readonly type: "ASSESSMENT"; readonly decision: AtlasNavigationDecision }
    | { readonly type: "REJECTED"; readonly reason: AtlasError }
    | { readonly type: "REVIEW"; readonly review: PolicyReview }
    | { readonly type: "OBSERVED" }
  ));

export interface AtlasControllerOptions {
  readonly repository: AtlasRepository;
  readonly clock: AtlasClock;
  /** Validated legacy host dependency. Active terms always come from the loaded snapshot. */
  readonly configuration: AtlasConfiguration;
  /** Fresh for each controller lifetime; supplied by the trusted host, never a website. */
  readonly ownerId: string;
  /** Trusted immutable compiled data; never a browser/website callback. */
  readonly managedBlacklist?: () => ManagedBlacklist | null;
  /** Trusted diagnostic sink only. Never awaited; throws cannot affect authority.
   * The host must sanitize exceptions before recording them. */
  readonly onInternalFault?: (error: unknown, fault: AtlasControllerFault) => void;
}

/** Read-only queue progress; no clock, snapshot, operation payload or permission. */
export interface AtlasControllerActivity {
  readonly operation: AtlasControllerFault['operation'];
  readonly stage: AtlasControllerFault['stage'];
  readonly active: boolean;
  readonly queued: number;
  readonly completed: number;
}

export interface AtlasController {
  /** Initialize or explicitly recover. Does not initialize missing data or replay commands. */
  open(): Promise<AtlasControllerView>;
  /** OBSERVE_TIME can recover CLOCK_ROLLBACK after the supplied clock catches up.
   * It fully revalidates authority, never clamps time or replays an operation. */
  handle(operation: unknown): Promise<AtlasControllerResponse>;
  getView(): AtlasControllerView;
  getActivity?(): AtlasControllerActivity;
}
