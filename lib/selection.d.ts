/** Plans the settings card can show. */
export declare const ZCODE_PLAN_IDS: readonly ["free", "paid"];
/** One plan id. */
export type ZcodePlanId = typeof ZCODE_PLAN_IDS[number];
/** Reasoning efforts the upstream accepts in `output_config.effort`. */
export declare const ZCODE_EFFORT_IDS: readonly ["minimal", "low", "medium", "high", "xhigh", "max"];
/** One effort id. */
export type ZcodeEffortId = typeof ZCODE_EFFORT_IDS[number];
/** Models the ZCode plan exposes (static: 0.17.0 has no quota-free listing). */
export declare const ZCODE_MODEL_IDS: readonly ["GLM-5.3-Flash", "GLM-5.3"];
/** One model id. */
export type ZcodeModelId = typeof ZCODE_MODEL_IDS[number];
/** The selection the card shows and the adapter uses. */
export interface ZcodeSelectionState {
    readonly plan: ZcodePlanId;
    readonly model: ZcodeModelId;
    readonly effort: ZcodeEffortId;
}
/** A partial write: only the keys present change. */
export interface ZcodeSelectionPatch {
    readonly plan?: string;
    readonly model?: string;
    readonly effort?: string;
}
/** Used when the file is missing, unreadable or carries an unknown value. */
export declare const ZCODE_DEFAULT_SELECTION: ZcodeSelectionState;
/**
 * Validate one parsed record into a complete selection.
 *
 * Unknown or missing values fall back to the default per field: a card that
 * loses its selection because one field got corrupted is worse than a card that
 * resets that one field. `changed` reports whether anything had to be replaced,
 * so the caller can log the recovery instead of hiding it.
 */
export declare function parseSelectionState(value: unknown): {
    readonly selection: ZcodeSelectionState;
    readonly changed: boolean;
};
/**
 * Apply a partial patch onto a selection.
 *
 * @throws RangeError when a provided value is not a known id — a caller that
 * tries to write `plan: 'yolo'` must be told, not silently clamped.
 */
export declare function applySelectionPatch(current: ZcodeSelectionState, patch: ZcodeSelectionPatch): ZcodeSelectionState;
/** Resolve the selection file path without touching the disk. */
export declare function selectionFilePath(env?: Record<string, string | undefined>): string;
/** Injected seams; everything defaults to the real filesystem. */
export interface SelectionStoreOptions {
    readonly filePath?: string;
    readonly env?: Record<string, string | undefined>;
    readonly readText?: (path: string) => Promise<string>;
    readonly writeText?: (path: string, text: string) => Promise<void>;
    readonly makeDirectory?: (path: string) => Promise<void>;
    readonly renameFile?: (from: string, to: string) => Promise<void>;
    readonly removeFile?: (path: string) => Promise<void>;
    readonly onRecovery?: (reason: string) => void;
}
/**
 * File-backed selection with a synchronous in-memory view.
 *
 * `get()` is synchronous on purpose: the adapter calls it once per turn and
 * must not await a disk read there. `prime()` loads the file at boot, `write()`
 * persists and updates the cache in the same step.
 */
export declare class SelectionStore {
    #private;
    constructor(options?: SelectionStoreOptions);
    /** Path this store persists to (exposed for diagnostics). */
    get filePath(): string;
    /** The current selection; never throws, never undefined. */
    get(): ZcodeSelectionState;
    /** Load the file into the cache. A missing file is normal, not an error. */
    prime(): Promise<ZcodeSelectionState>;
    /** Persist a patch and return the new selection. */
    write(patch: ZcodeSelectionPatch): Promise<ZcodeSelectionState>;
}
//# sourceMappingURL=selection.d.ts.map