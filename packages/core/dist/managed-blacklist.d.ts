declare const managedBrand: unique symbol;
/** Opaque runtime data. Only Core compilation creates valid instances. */
export interface ManagedBlacklist {
    readonly size: number;
    readonly [managedBrand]: true;
}
export declare function compileManagedBlacklist(input: unknown): ManagedBlacklist | null;
export declare function isManagedBlacklist(input: unknown): input is ManagedBlacklist;
/** Callers normalize a single target. Invalid compiled authority is never an empty list. */
export declare function managedBlacklistContains(input: unknown, hostname: string): boolean | null;
export {};
