/** Equality for validated, owned JSON domain data only. Preserve array order and
 * every field; identity can skip an immutable shared subtree, never a decision. */
export declare function sameAtlasData(left: unknown, right: unknown): boolean;
