/**
 * Plugin-owned selection store: which plan, model and reasoning effort the
 * user picked in the settings card.
 *
 * Why a file of our own instead of the bundle config: the card has to change
 * the selection without a host restart, and the adapter has to read the same
 * value the card wrote. Writing ZCode's own `provider_config.json` is out of
 * the question — it belongs to another application and carries its API key.
 *
 * Layout: `<dsh home>/zcode-provider/selection.json`, atomic replace (write to
 * a temp name in the same directory, then `rename`), so a crash mid-write can
 * never leave a half-parsed selection behind.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** Plans the settings card can show. */
export const ZCODE_PLAN_IDS = ['free', 'paid'];
/** Reasoning efforts the upstream accepts in `output_config.effort`. */
export const ZCODE_EFFORT_IDS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
/** Models the ZCode plan exposes (static: 0.17.0 has no quota-free listing). */
export const ZCODE_MODEL_IDS = ['GLM-5.3-Flash', 'GLM-5.3'];
/** Used when the file is missing, unreadable or carries an unknown value. */
export const ZCODE_DEFAULT_SELECTION = Object.freeze({
    // `free` is the default plan: it is the one the CLI signs its own requests
    // with, so no extra credential is needed. `paid` only changes what the card
    // shows; the transport is always the official CLI subprocess.
    plan: 'free',
    model: 'GLM-5.3-Flash',
    effort: 'max',
});
function includes(values, value) {
    return typeof value === 'string' && values.includes(value);
}
/**
 * Validate one parsed record into a complete selection.
 *
 * Unknown or missing values fall back to the default per field: a card that
 * loses its selection because one field got corrupted is worse than a card that
 * resets that one field. `changed` reports whether anything had to be replaced,
 * so the caller can log the recovery instead of hiding it.
 */
export function parseSelectionState(value) {
    const record = typeof value === 'object' && value !== null ? value : {};
    const plan = includes(ZCODE_PLAN_IDS, record['plan']) ? record['plan'] : ZCODE_DEFAULT_SELECTION.plan;
    const model = includes(ZCODE_MODEL_IDS, record['model']) ? record['model'] : ZCODE_DEFAULT_SELECTION.model;
    const effort = includes(ZCODE_EFFORT_IDS, record['effort']) ? record['effort'] : ZCODE_DEFAULT_SELECTION.effort;
    const changed = plan !== record['plan'] || model !== record['model'] || effort !== record['effort'];
    return { selection: { plan, model, effort }, changed };
}
/**
 * Apply a partial patch onto a selection.
 *
 * @throws RangeError when a provided value is not a known id — a caller that
 * tries to write `plan: 'yolo'` must be told, not silently clamped.
 */
export function applySelectionPatch(current, patch) {
    const next = {
        plan: patch.plan === undefined ? current.plan : patch.plan,
        model: patch.model === undefined ? current.model : patch.model,
        effort: patch.effort === undefined ? current.effort : patch.effort,
    };
    if (!includes(ZCODE_PLAN_IDS, next.plan))
        throw new RangeError(`unknown plan: ${String(next.plan)}`);
    if (!includes(ZCODE_MODEL_IDS, next.model))
        throw new RangeError(`unknown model: ${String(next.model)}`);
    if (!includes(ZCODE_EFFORT_IDS, next.effort))
        throw new RangeError(`unknown effort: ${String(next.effort)}`);
    return { plan: next.plan, model: next.model, effort: next.effort };
}
/** Resolve the selection file path without touching the disk. */
export function selectionFilePath(env = process.env) {
    const home = env['DSH_HOME']?.trim() || join(homedir(), '.dsh');
    return join(home, 'zcode-provider', 'selection.json');
}
/**
 * File-backed selection with a synchronous in-memory view.
 *
 * `get()` is synchronous on purpose: the adapter calls it once per turn and
 * must not await a disk read there. `prime()` loads the file at boot, `write()`
 * persists and updates the cache in the same step.
 */
export class SelectionStore {
    #filePath;
    #readText;
    #writeText;
    #makeDirectory;
    #renameFile;
    #removeFile;
    #onRecovery;
    #current = ZCODE_DEFAULT_SELECTION;
    /** Serialises writes: two saves racing would otherwise interleave renames. */
    #queue = Promise.resolve();
    constructor(options = {}) {
        this.#filePath = options.filePath ?? selectionFilePath(options.env);
        this.#readText = options.readText ?? ((path) => readFile(path, 'utf8'));
        this.#writeText = options.writeText ?? ((path, text) => writeFile(path, text, 'utf8'));
        this.#makeDirectory = options.makeDirectory ?? (async (path) => { await mkdir(path, { recursive: true }); });
        this.#renameFile = options.renameFile ?? (async (from, to) => { await rename(from, to); });
        this.#removeFile = options.removeFile ?? (async (path) => { await unlink(path); });
        this.#onRecovery = options.onRecovery;
    }
    /** Path this store persists to (exposed for diagnostics). */
    get filePath() {
        return this.#filePath;
    }
    /** The current selection; never throws, never undefined. */
    get() {
        return this.#current;
    }
    /** Load the file into the cache. A missing file is normal, not an error. */
    async prime() {
        let text;
        try {
            text = await this.#readText(this.#filePath);
        }
        catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
            if (code === 'ENOENT')
                return this.#current;
            this.#onRecovery?.(`selection file unreadable: ${String(code ?? error)}`);
            return this.#current;
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            this.#onRecovery?.('selection file is not valid JSON');
            return this.#current;
        }
        const { selection, changed } = parseSelectionState(parsed);
        if (changed)
            this.#onRecovery?.('selection file had missing or unknown values; recovered with defaults');
        this.#current = selection;
        return selection;
    }
    /** Persist a patch and return the new selection. */
    async write(patch) {
        // The patch is applied *inside* the queued run, not before queuing: two
        // writes arriving together must compose against each other. Applying up
        // front would merge both against the same pre-queue snapshot and the first
        // write's field would be silently lost (pick "paid", then "effort=low", end
        // up back on "free").
        const run = async () => {
            const next = applySelectionPatch(this.#current, patch);
            const directory = dirname(this.#filePath);
            await this.#makeDirectory(directory);
            const temp = `${this.#filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
            try {
                await this.#writeText(temp, `${JSON.stringify(next, null, 2)}\n`);
                await this.#renameFile(temp, this.#filePath);
            }
            catch (error) {
                // Best effort: an orphan temp file must not survive a failed rename.
                try {
                    await this.#removeFile(temp);
                }
                catch {
                    // Nothing to clean up, or the cleanup itself failed; the write error wins.
                }
                throw error;
            }
            this.#current = next;
            return next;
        };
        const queued = this.#queue.then(run, run);
        // Keep the chain alive after a rejection so one failed save does not block
        // every later save.
        this.#queue = queued.catch(() => undefined);
        return queued;
    }
}
//# sourceMappingURL=selection.js.map