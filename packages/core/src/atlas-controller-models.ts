import type { AtlasConfiguration, AtlasError, AtlasNavigationDecision, AtlasOperation, AtlasSnapshot } from "./atlas-models.js";
import type { AtlasClock, AtlasRepository } from "./atlas-ports.js";
import type { PolicyReview } from "./vault-models.js";
import type { ManagedBlacklist } from "./managed-blacklist.js";

export type AtlasControllerStatus =
  | "UNINITIALIZED" | "LOADING" | "READY" | "COMMITTING" | "RECONCILING" | "UNAVAILABLE";

export type AtlasControllerError =
  | "NOT_OPEN" | "NOT_READY" | "UNINITIALIZED" | "STORAGE_UNAVAILABLE" | "CORRUPT_STATE"
  | "STORAGE_ROLLBACK" | "WRITE_FAILED" | "STORAGE_CONFLICT" | "COMMIT_UNKNOWN"
  | "AUTHORITY_CHANGED" | "CLOCK_UNAVAILABLE" | "INVALID_TIME" | "CLOCK_ROLLBACK"
  | "REEVALUATION_REQUIRED" | "ID_EXHAUSTED" | "INTERNAL_ERROR" | "MANAGED_BLACKLIST_UNAVAILABLE";

export interface AtlasControllerView {
  readonly status: AtlasControllerStatus;
  readonly reason: AtlasControllerError | null;
  /** Last verified data, not authority to execute. May be stale when status is not READY. */
  readonly snapshot: AtlasSnapshot | null;
  readonly storageVersion: string | null;
  readonly pendingCommitId: string | null;
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
}

export interface AtlasController {
  /** Initialize or explicitly recover. Does not initialize missing data or replay commands. */
  open(): Promise<AtlasControllerView>;
  handle(operation: unknown): Promise<AtlasControllerResponse>;
  getView(): AtlasControllerView;
}
