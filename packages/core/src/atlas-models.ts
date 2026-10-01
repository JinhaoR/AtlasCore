import type { AccessDecision, AccessError, AccessState, AccessTiming } from "./access-models.js";
import type { JourneyContinuation, JourneyDecision, JourneyError, JourneyLimits, JourneyState } from "./journey-models.js";
import type { Policy, SiteTarget } from "./models.js";
import type { PolicyReview, VaultError, VaultState, VaultTiming } from "./vault-models.js";
import type { ManagedBlacklist } from "./managed-blacklist.js";

/** Complete domain data; neither a storage envelope nor an acknowledgement of authority. */
export interface AtlasSnapshot {
  readonly policy: Policy;
  readonly policyRevision: number;
  readonly configuration: AtlasConfiguration;
  readonly configurationRevision: number;
  readonly accessState: AccessState;
  readonly vaultState: VaultState;
  readonly journeyState: JourneyState;
}

export type AtlasSnapshotComponent = "snapshot" | keyof AtlasSnapshot;
export type AtlasSnapshotError =
  | "INVALID_SNAPSHOT" | "INVALID_POLICY" | "INVALID_POLICY_REVISION"
  | "INVALID_ACCESS_STATE" | "INVALID_VAULT_STATE" | "INVALID_JOURNEY_STATE"
  | "POLICY_ROLLBACK" | "INVALID_CONFIGURATION" | "CONFIGURATION_ROLLBACK";

export type AtlasSnapshotValidation =
  | { readonly ok: true; readonly snapshot: AtlasSnapshot }
  | { readonly ok: false; readonly reason: AtlasSnapshotError; readonly component: AtlasSnapshotComponent };

export interface AtlasConfiguration {
  readonly accessTiming: AccessTiming;
  readonly vaultTiming: VaultTiming;
  readonly journeyLimits: JourneyLimits;
}

/** Identity is supplied by the trusted owner; this is not proof of a browser binding. */
export interface AtlasNavigationContext {
  readonly contextId: string;
  readonly journeyId: number | null;
  readonly continuation?: JourneyContinuation;
}

export interface AtlasPlannerContext {
  readonly snapshot: AtlasSnapshot;
  readonly now: number;
  /** Legacy dependency validation only; committed snapshot.configuration governs operations. */
  readonly configuration: AtlasConfiguration;
  readonly managedBlacklist?: ManagedBlacklist;
}

export type AtlasOperation =
  | { readonly kind: "BEGIN_NAVIGATION" | "CHECK_NAVIGATION" | "RECORD_JOURNEY_NAVIGATION";
    readonly target: SiteTarget; readonly context: AtlasNavigationContext }
  | { readonly kind: "START_ACCESS"; readonly target: SiteTarget; readonly scopeHostnames?: readonly string[] }
  | { readonly kind: "CONFIRM_ACCESS" | "CANCEL_ACCESS"; readonly requestId: number }
  | { readonly kind: "PROPOSE_POLICY"; readonly candidatePolicy: Policy }
  | { readonly kind: "PROPOSE_SETTINGS"; readonly candidateConfiguration: AtlasConfiguration }
  | { readonly kind: "REVIEW_POLICY" | "CONFIRM_POLICY" | "CANCEL_POLICY"; readonly proposalId: number }
  | { readonly kind: "START_JOURNEY"; readonly root: SiteTarget; readonly contextId: string }
  | { readonly kind: "CANCEL_JOURNEY" | "CLOSE_JOURNEY_CONTEXT";
    readonly journeyId: number; readonly contextId: string }
  | { readonly kind: "OBSERVE_TIME" };

export type AtlasError = AtlasSnapshotError | AccessError | VaultError | JourneyError
  | "INVALID_CONTEXT" | "INVALID_CONFIGURATION" | "INVALID_OPERATION"
  | "INVALID_MANAGED_BLACKLIST" | "MANAGED_BLACKLISTED";
export type AtlasNavigationDecision = AccessDecision | JourneyDecision
  | { readonly outcome: "DENY"; readonly reason: "MANAGED_BLACKLISTED"; readonly target: SiteTarget };

export type AtlasPlanResult =
  | { readonly type: "REJECTED"; readonly reason: AtlasError }
  | { readonly type: "ASSESSMENT"; readonly decision: AtlasNavigationDecision }
  | { readonly type: "TRANSITION_PREPARED"; readonly operation: AtlasOperation["kind"];
    readonly id: number }
  | { readonly type: "POLICY_COMMIT_PREPARED"; readonly proposalId: number;
    readonly expectedPolicyRevision: number }
  | { readonly type: "REVIEW"; readonly review: PolicyReview }
  | { readonly type: "OBSERVED" };

/** Every result is a pure plan. Even an ALLOW assessment cannot execute a browser action. */
export interface AtlasPlan {
  readonly result: AtlasPlanResult;
  /** Conservative observations only. Retain these even if a command is rejected. */
  readonly observationSnapshot: AtlasSnapshot | null;
  /** Complete proposed transition, requiring a successful atomic commit before publication. */
  readonly candidateSnapshot: AtlasSnapshot | null;
}
