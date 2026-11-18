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
import { type ModelConfig } from './provider/config.js';
import { type ZcodeEnv } from './zcode/process.js';
/** The verdict a single doctor check can carry. */
export type DiagnosticStatus = 'pass' | 'warn' | 'fail' | 'skipped';
/** Result of reading the Node version that will run `zcode.cjs`. */
export interface NodeVersionProbe {
    /** Version string as reported by the caller (`process.versions.node` by default). */
    readonly version: string;
    /** Parsed major version, or `null` when the string is not a version at all. */
    readonly major: number | null;
    /** The floor ZCode 0.17.0 needs because it loads `node:sqlite`. */
    readonly minimum: number;
    readonly supported: boolean;
}
/**
 * Parse and judge a Node version string against `MIN_NODE_MAJOR`.
 *
 * The version is a parameter, not a global read, so the doctor can report about
 * the interpreter that will actually run the CLI rather than the one that
 * happens to host the plugin.
 */
export declare function probeNodeVersion(version?: string): NodeVersionProbe;
/** One contract entry as found in the environment being inspected. */
export interface EnvContractEntryProbe {
    readonly name: string;
    /** Value this host must carry, from `ZCODE_ENV_CONTRACT`. */
    readonly expected: string;
    readonly present: boolean;
    /** Present value, verbatim; `null` when absent or blank. */
    readonly value: string | null;
    /**
     * Whether the value equals the recorded expectation. A mismatch is not a
     * failure: the recorded values are this host's instalment, and another
     * instalment may legitimately live elsewhere.
     */
    readonly matchesExpected: boolean;
}
/** Result of walking `ZCODE_ENV_CONTRACT` against one environment. */
export interface EnvContractProbe {
    /** Strictly the fail-closed question: is every entry present and non-blank. */
    readonly ok: boolean;
    readonly missing: readonly string[];
    readonly mismatched: readonly string[];
    readonly entries: readonly EnvContractEntryProbe[];
}
/** Read the contract expectation recorded for `name`, or `null` when unknown. */
export declare function expectedEnvValue(name: string): string | null;
/**
 * Walk the five contract entries over `env`.
 *
 * Mirrors `missingEnvKeys()` but keeps the per-entry detail a doctor needs:
 * which entries are absent, and which are present with a value that differs
 * from the recorded one (typically a stale host after moving the install).
 */
export declare function probeEnvContract(env: ZcodeEnv): EnvContractProbe;
export type ProbePathKind = 'file' | 'directory';
/** Result of one `statSync` on a path the provider depends on. */
export interface PathProbe {
    readonly path: string;
    readonly kind: ProbePathKind;
    readonly exists: boolean;
    /** Exists *and* is of the expected kind. */
    readonly correctType: boolean;
    readonly sizeBytes: number | null;
    readonly error: string | null;
}
/**
 * Stat one path without following it into anything expensive.
 *
 * `exists: false` with a non-null `error` is the interesting case for a doctor:
 * a permission problem and a missing file are different repairs even though
 * both make the provider unusable.
 */
export declare function probePath(path: string, kind?: ProbePathKind): PathProbe;
/** Result of reading one `provider_config.json` (never written). */
export interface ProviderConfigProbe {
    readonly path: string;
    readonly exists: boolean;
    readonly readable: boolean;
    /** Parsed as a JSON object; `false` for a missing, unreadable, or bad file. */
    readonly parsed: boolean;
    /** `defaultModelSelection` when it is a string, else `null`. */
    readonly defaultModelSelection: string | null;
    /** Length of the first model id array found, else `null`. */
    readonly personalModelCount: number | null;
    readonly error: string | null;
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
export declare function probeProviderConfig(path: string, readTextFile?: (path: string) => string): ProviderConfigProbe;
/** Result of judging the configured catalog against the static one. */
export interface ModelCatalogProbe {
    /** Non-empty *and* lists the default model. */
    readonly ok: boolean;
    readonly defaultModel: string;
    readonly ids: readonly string[];
    readonly defaultListed: boolean;
    /** Ids that the adapter cannot serve: not in the static catalog. */
    readonly unexpected: readonly string[];
}
/**
 * Judge a model catalog.
 *
 * ZCode 0.17.0 is reached through a fixed pair of static model ids (design D2),
 * so an id outside `DEFAULT_MODELS` is not a preference the adapter can honour:
 * it is a configuration drift the doctor must report before a request fails.
 */
export declare function probeModelCatalog(models: readonly ModelConfig[], defaultModel: string, knownIds?: readonly string[]): ModelCatalogProbe;
/**
 * Local recollection of the most recent provider-side quota rejection.
 *
 * This is deliberately a memory, not a query: the plugin cannot ask ZCode for
 * plan state, and pretending otherwise is exactly the field the report must not
 * carry. When the adapter sees provider code 1309 it calls
 * `recordQuotaObservation()`; the doctor then reports what was last seen, or
 * `null` when nothing was seen in this process.
 */
export interface QuotaObservation {
    /** ISO timestamp of the observation. */
    readonly observedAt: string;
    /** Provider-side code (`1309` for the quota rejection seen on this host). */
    readonly providerCode: string | null;
    readonly requestId: string | null;
}
/** Provider code ZCode returns when the account is out of quota. */
export declare const QUOTA_PROVIDER_CODE = "1309";
/** Record one quota rejection; later calls replace earlier ones. */
export declare function recordQuotaObservation(error: {
    readonly providerCode?: string | undefined;
    readonly requestId?: string | undefined;
}, observedAt?: string): QuotaObservation;
/** The last recorded quota rejection, or `null` when none was recorded. */
export declare function lastQuotaObservation(): QuotaObservation | null;
/** Forget the recorded rejection (test isolation; no runtime caller needs it). */
export declare function clearQuotaObservation(): void;
//# sourceMappingURL=diagnostics.d.ts.map