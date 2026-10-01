import type { AtlasSnapshot } from "./atlas-models.js";

export interface AtlasClock {
  now(): number;
}

export interface AtlasEnvelope {
  readonly schemaVersion: 2;
  readonly storageVersion: string;
  readonly lastCommitId: string | null;
  readonly snapshot: AtlasSnapshot;
}

export type AtlasLoadResult =
  | { readonly type: "READY"; readonly envelope: unknown }
  | { readonly type: "UNINITIALIZED" | "UNAVAILABLE" }
  | { readonly type: "UNRESOLVED"; readonly commitId: string };

export interface AtlasCommitRequest {
  readonly expectedStorageVersion: string;
  readonly commitId: string;
  readonly next: { readonly schemaVersion: 2; readonly snapshot: AtlasSnapshot };
}

export type AtlasCommitResolution =
  | { readonly type: "COMMITTED"; readonly commitId: string; readonly storageVersion: string }
  | { readonly type: "NOT_WRITTEN"; readonly commitId: string }
  | { readonly type: "UNKNOWN"; readonly commitId: string };

export type AtlasCommitResult = AtlasCommitResolution
  | { readonly type: "CONFLICT"; readonly commitId: string };

/**
 * Host implementation: atomic version-checked replacement and authoritative reads.
 * READY must fence all earlier writes: none may still apply later. Return UNRESOLVED
 * while that cannot be established. NOT_WRITTEN is final, never a timeout guess.
 * Commit IDs are unique attempts; resolution never retries a write.
 */
export interface AtlasRepository {
  load(): Promise<AtlasLoadResult>;
  commit(request: AtlasCommitRequest): Promise<AtlasCommitResult>;
  resolveCommit(commitId: string): Promise<AtlasCommitResolution>;
}
