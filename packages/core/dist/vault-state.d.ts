import type { Policy } from "./models.js";
import type { VaultContext, VaultError, VaultState } from "./vault-models.js";
export { readVaultTiming } from "./configuration.js";
/** Only use on newly owned, acyclic domain data; never freeze caller-owned inputs. */
export declare function freezeVaultData<T>(value: T): T;
export declare function canonicalPolicy(value: unknown): Policy | null;
/** Both arguments have already been canonicalized. */
export declare function samePolicy(left: Policy, right: Policy): boolean;
/** Explicit initialization only; never a fallback for damaged existing state. */
export declare function createVaultState(): VaultState;
export declare function readVaultState(value: unknown): VaultState | null;
type PreparedVaultContext = {
    readonly ok: true;
    readonly value: VaultContext;
} | {
    readonly ok: false;
    readonly reason: VaultError;
};
/** Validate and copy the complete latest snapshot before computing any change. */
export declare function prepareVaultContext(input: unknown): PreparedVaultContext;
