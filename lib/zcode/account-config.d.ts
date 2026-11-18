/**
 * Build the `provider/updateAccountConfig` payload from the ZCode builtin
 * provider config.
 *
 * The builtin file (`zcode-builtin.json`, `revision` at the top level) lists
 * every account provider under `config.providerConfigRules.providerRules`
 * with a `providerId` prefixed `account:`. The injection mirrors what the real
 * ZCode client sends: all ten account providers, each with
 * `access.{type,entitled}` and `builtinModelIds`, plus per-provider state.
 *
 * The builtin-revision tag is the exact string the CLI accepts:
 * `zcode-builtin:<release.revision>:<sha256(path.resolve(builtinPath))>`
 * (hex, no separators). Anything else makes the registry treat the update as
 * stale and silently drop it.
 */
/**
 * The `zcode-builtin:<revision>:<hash>` tag the running ZCode runtime actually
 * reports, read from the desktop client's own delivery lines in its log (every
 * "account provider config 已交付" entry echoes the tag the registry accepted).
 * Reading it from the log also makes the injection self-adapting: when the
 * desktop updates and the builtin revision moves, the next delivery line
 * carries the new tag and this picks it up without a plugin change.
 */
export declare function readRuntimeBuiltinRevisionTag(logDir?: string): string | undefined;
/** One account provider read from the builtin table. */
export interface ZcodeAccountProviderEntry {
    readonly providerId: string;
    readonly modelIds: readonly string[];
    readonly baseUrl: string;
    readonly mode: string;
    readonly accountType: 'zai' | 'bigmodel';
}
export interface ZcodeAccountConfig {
    readonly basedOnZCodeBuiltinRevision: string;
    readonly updateParams: {
        readonly revision: string;
        readonly basedOnZCodeBuiltinRevision: string;
        readonly providers: Readonly<Record<string, {
            readonly access: {
                readonly type: 'zhipu-account';
                readonly entitled: boolean;
            };
            readonly builtinModelIds?: readonly string[];
        }>>;
        readonly states: Readonly<Record<string, {
            readonly availability: 'available' | 'unavailable' | 'unknown';
            readonly entitled: boolean;
            readonly current: boolean;
            readonly connectionKey: string;
            readonly unavailableReason?: string;
        }>>;
    };
    readonly entries: readonly ZcodeAccountProviderEntry[];
    /** The injected providerId this plan resolves to. */
    readonly providerId: string;
}
export interface BuildAccountConfigOptions {
    readonly builtinPath: string;
    readonly accountType: 'zai' | 'bigmodel';
    /** Target mode, e.g. `start-plan`. */
    readonly mode: string;
    /** Overrides the canonical revision (tests pin determinism); defaults to canonical. */
    readonly revisionSeed?: string;
    /** Models the injected target provider advertises; defaults to the builtin list. */
    readonly modelIds?: readonly string[] | undefined;
    /** Overrides the start-plan connection key (defaults to the desktop sample). */
    readonly connectionKey?: string | undefined;
    /** Overrides the builtin revision tag (tests); defaults to the runtime-reported one. */
    readonly builtinRevisionTag?: string | undefined;
    /** Log directory the runtime-reported tag is read from (tests inject an empty dir). */
    readonly runtimeLogDir?: string | undefined;
    readonly readFile?: ((path: string) => string) | undefined;
    readonly hash?: ((text: string) => string) | undefined;
}
/**
 * Read the builtin config and produce the injection payload.
 *
 * @throws Error (code `ZCODE_ACCOUNT_CONFIG_INVALID` in `message`) when the
 * file is unreadable, not JSON, or the target mode is not in the table.
 */
export declare function buildZcodeAccountConfig(options: BuildAccountConfigOptions): ZcodeAccountConfig;
/**
 * Connection key the desktop client sends for the start-plan slot (read from
 * the 2026-10-25 desktop delivery log; probe3 confirmed the account layer
 * activates with this value). It keys the connection identity in the registry
 * states — without it the injection is received but the free-plan view never
 * appears in the model catalog.
 */
export declare const DEFAULT_START_PLAN_CONNECTION_KEY = "0132285dc3675ec4eb4abf92aa3d2514abc6701b0d7c806be9e1acfcc558052d";
/** Shared key for the not-connected slots (desktop sample value). */
export declare const DEFAULT_OFF_CONNECTION_KEY = "41717a7a173a5e88981ed3b30d6c754715277dce3b302a8e7b1386cdf57b9b4c";
//# sourceMappingURL=account-config.d.ts.map