import type { AtlasSnapshotValidation } from "./atlas-models.js";
/** Validate and copy without observing time, ending Journeys, or initializing missing state. */
export declare function validateAtlasSnapshot(input: unknown): AtlasSnapshotValidation;
/** Explicit v1 migration only. Validate legacy shape before freezing the existing deployment settings. */
export declare function migrateAtlasSnapshotV1(input: unknown, configurationInput: unknown): AtlasSnapshotValidation;
