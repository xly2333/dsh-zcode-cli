/**
 * Read-only diagnostics for the ZCode provider.
 *
 * Every probe here observes the host and returns a plain record: nothing in
 * this module spawns ZCode, writes a file, or mutates the personal ZCode store.
 * Splitting "observe" (this file) from "judge" (`src/doctor.ts`) is what lets
 * the tests exercise the whole diagnostic surface against injected paths,
 * environments, and Node versions without ever reading this machine's real
 * ZCode installation.
 */
import { readFileSync, statSync } from 'node:fs';
import { DEFAULT_MODELS } from './provider/config.js';
import { MIN_NODE_MAJOR, ZCODE_ENV_CONTRACT } from './zcode/process.js';
/** Fs error text is bounded so a pathological message cannot flood a report. */
const PROBE_ERROR_MAX_CHARS = 240;
function boundMessage(value) {
    const message = value instanceof Error ? value.message : String(value);
    return message.length > PROBE_ERROR_MAX_CHARS
        ? `${message.slice(0, PROBE_ERROR_MAX_CHARS)}...`
        : message;
}
/**
 * Parse and judge a Node version string against `MIN_NODE_MAJOR`.
 *
 * The version is a parameter, not a global read, so the doctor can report about
 * the interpreter that will actually run the CLI rather than the one that
 * happens to host the plugin.
 */
export function probeNodeVersion(version = process.versions.node) {
    const match = /^(\d+)/.exec(version.trim());
    const parsed = match === null ? null : Number(match[1]);
    const major = parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
    return {
        version,
        major,
        minimum: MIN_NODE_MAJOR,
        supported: major !== null && major >= MIN_NODE_MAJOR,
    };
}
/** Read the contract expectation recorded for `name`, or `null` when unknown. */
export function expectedEnvValue(name) {
    const entry = ZCODE_ENV_CONTRACT.find(candidate => candidate.name === name);
    return entry === undefined ? null : entry.expected;
}
/**
 * Walk the five contract entries over `env`.
 *
 * Mirrors `missingEnvKeys()` but keeps the per-entry detail a doctor needs:
 * which entries are absent, and which are present with a value that differs
 * from the recorded one (typically a stale host after moving the install).
 */
export function probeEnvContract(env) {
    const entries = ZCODE_ENV_CONTRACT.map((contract) => {
        const raw = env[contract.name];
        const present = raw !== undefined && raw.trim().length > 0;
        return {
            name: contract.name,
            expected: contract.expected,
            present,
            value: present ? raw.trim() : null,
            matchesExpected: present && raw.trim() === contract.expected,
        };
    });
    return {
        ok: entries.every(entry => entry.present),
        missing: entries.filter(entry => !entry.present).map(entry => entry.name),
        mismatched: entries
            .filter(entry => entry.present && !entry.matchesExpected)
            .map(entry => entry.name),
        entries,
    };
}
/**
 * Stat one path without following it into anything expensive.
 *
 * `exists: false` with a non-null `error` is the interesting case for a doctor:
 * a permission problem and a missing file are different repairs even though
 * both make the provider unusable.
 */
export function probePath(path, kind = 'file') {
    try {
        const stats = statSync(path);
        const correctType = kind === 'file' ? stats.isFile() : stats.isDirectory();
        return {
            path,
            kind,
            exists: true,
            correctType,
            sizeBytes: stats.isFile() ? stats.size : null,
            error: correctType ? null : `path exists but is not a ${kind}`,
        };
    }
    catch (error) {
        return {
            path,
            kind,
            exists: false,
            correctType: false,
            sizeBytes: null,
            error: boundMessage(error),
        };
    }
}
/** Arrays that may hold model ids in a ZCode provider config, in probe order. */
const MODEL_ID_ARRAY_KEYS = ['personalModelIds', 'personalModels', 'models'];
function readText(path) {
    return readFileSync(path, 'utf8');
}
/**
 * Read one ZCode provider config read-only.
 *
 * Only two facts are extracted -- the default model selection and how many
 * personal model ids are listed -- because those are the two the provider needs
 * to keep its catalog honest, and neither carries the identity values the file
 * holds. The file itself is
 * the account's identity (`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`); nothing here
 * copies values out of it beyond the model selection.
 */
export function probeProviderConfig(path, readTextFile = readText) {
    const empty = {
        path,
        exists: false,
        readable: false,
        parsed: false,
        defaultModelSelection: null,
        personalModelCount: null,
    };
    const stat = probePath(path, 'file');
    if (!stat.exists || !stat.correctType) {
        return { ...empty, error: stat.error ?? 'file not found' };
    }
    let text;
    try {
        text = readTextFile(path);
    }
    catch (error) {
        return { ...empty, exists: true, error: boundMessage(error) };
    }
    let value;
    try {
        value = JSON.parse(text.replace(/^\uFEFF/, ''));
    }
    catch (error) {
        return { ...empty, exists: true, readable: true, error: boundMessage(error) };
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ...empty, exists: true, readable: true, error: 'top-level JSON value is not an object' };
    }
    const record = value;
    const selection = record.defaultModelSelection;
    const arrayKey = MODEL_ID_ARRAY_KEYS.find(key => Array.isArray(record[key]));
    const listed = arrayKey === undefined ? undefined : record[arrayKey];
    return {
        path,
        exists: true,
        readable: true,
        parsed: true,
        defaultModelSelection: typeof selection === 'string' && selection.trim().length > 0
            ? selection.trim()
            : null,
        personalModelCount: Array.isArray(listed) ? listed.length : null,
        error: null,
    };
}
/**
 * Judge a model catalog.
 *
 * ZCode 0.17.0 is reached through a fixed pair of static model ids (design D2),
 * so an id outside `DEFAULT_MODELS` is not a preference the adapter can honour:
 * it is a configuration drift the doctor must report before a request fails.
 */
export function probeModelCatalog(models, defaultModel, knownIds = DEFAULT_MODELS.map(model => model.id)) {
    const ids = models.map(model => model.id);
    return {
        ok: ids.length > 0 && ids.includes(defaultModel),
        defaultModel,
        ids,
        defaultListed: ids.includes(defaultModel),
        unexpected: ids.filter(id => !knownIds.includes(id)),
    };
}
/** Provider code ZCode returns when the account is out of quota. */
export const QUOTA_PROVIDER_CODE = '1309';
let lastQuota = null;
/** Record one quota rejection; later calls replace earlier ones. */
export function recordQuotaObservation(error, observedAt = new Date().toISOString()) {
    lastQuota = {
        observedAt,
        providerCode: error.providerCode ?? QUOTA_PROVIDER_CODE,
        requestId: error.requestId ?? null,
    };
    return lastQuota;
}
/** The last recorded quota rejection, or `null` when none was recorded. */
export function lastQuotaObservation() {
    return lastQuota;
}
/** Forget the recorded rejection (test isolation; no runtime caller needs it). */
export function clearQuotaObservation() {
    lastQuota = null;
}
//# sourceMappingURL=diagnostics.js.map