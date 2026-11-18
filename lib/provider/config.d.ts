import z from '@deepseek-ai/schemastery';
/** Ownership policy for DSH tool schemas on the ZCode route. */
export type ZcodeToolPolicy = 'reject' | 'zcode-owned' | 'dsh-owned';
/** Image attachment mode; `experimental` is the verified CLI-native localPath channel. */
export type ZcodeImageInput = 'off' | 'experimental';
/**
 * ZCode CLI permission mode.
 *
 * `guarded` denies every CLI tool permission callback; `yolo` answers `allow`
 * inside the adapter's own permission callback, which is how the CLI's native
 * tools stay usable on an unattended bridge. The argv builder never sends
 * `--mode` in either case.
 */
export type ZcodeMode = 'guarded' | 'yolo';
/** Environment variable naming the ZCode *data* root (`<root>/.zcode/v2/...`). */
export declare const ZCODE_DATA_BASE_DIR_ENV = "ZCODE_DATA_BASE_DIR";
export interface ModelConfig {
    /** Exact model id passed to ZCode. */
    id: string;
    /** Optional selector label; defaults to `id`. */
    name?: string;
    /** Optional selector description. */
    description?: string;
    /** Optional provider-declared combined context capacity. */
    contextWindow?: number;
}
export interface ZcodeRetryPolicyConfig {
    /** Eligible retries after the first ZCode process; hard capped at DSH's default of 5. */
    maxRetries?: number;
    /** Delay before attempt N+1, multiplied by N where backoff is linear. */
    backoffMs?: number;
    /** Stable transient codes allowed to consume another ZCode attempt. */
    retryableCodes?: string[];
}
export interface Config {
    /** Keep the bundle inert until explicitly enabled. */
    enabled?: boolean;
    /** DSH provider route owned by this plugin. */
    provider?: string;
    /** ZCode model passed to the CLI when a request does not override it. */
    model?: string;
    /** Explicit model catalog; `model` remains the default/fallback entry. */
    models?: ModelConfig[];
    /** Visible models filter; empty means show every catalog entry. */
    visibleModels?: string[];
    /**
     * Model discovery mode. `off` is the only supported value: ZCode 0.17.0 has
     * no quota-free model listing command, so a discovery path would have to
     * spend a real turn (and a real quota unit) to enumerate anything.
     */
    modelDiscovery?: 'off';
    /** Ownership policy for DSH tool schemas; ZCode stays the internal tool owner. */
    toolPolicy?: ZcodeToolPolicy;
    /**
     * Project the DSH tool registry to ZCode over MCP.
     *
     * Takes effect only when `toolPolicy` is `dsh-owned`: that is the policy that
     * promises the host executes the tools, and the bridge is what makes the
     * promise true. Off keeps the CLI's built-in tools only.
     */
    mcpBridge?: boolean;
    /**
     * Tool names handed to the CLI's `session/create.toolAllowlist`.
     *
     * Pass-through only: the key exists in the CLI's strict schema, but what it
     * filters (and whether names are bare or `mcp__server__tool`) was never
     * measured here. Empty means "do not send the key at all".
     */
    toolAllowlist?: string[];
    /** Tool names handed to `session/create.toolDenylist`; same caveat as above. */
    toolDenylist?: string[];
    /** CLI permission mode; fixed to `guarded`. */
    mode?: ZcodeMode;
    /** `resume` reuses a ZCode session id, `full` replays the whole history. */
    sessionMode?: 'resume' | 'full';
    /** Durable sessionId to conversationId map path; empty uses DSH_HOME/zcode-provider/sessions.json. */
    sessionStorePath?: string;
    /** Extra host environment variable names the child may inherit (closed allowlist otherwise). */
    passEnv?: string[];
    /** Image input mode. */
    imageInput?: ZcodeImageInput;
    /**
     * Give the CLI child its own HOME seeded with the host global AGENTS.md, so
     * user instructions arrive via the CLI-native trusted channel instead of
     * pasted prompt text.
     */
    isolatedHome?: boolean;
    /**
     * Render the DSH system prompt into the CLI prompt. The CLI is a full agent
     * with its own system prompt, so the default (`false`) keeps the DSH preset
     * (and anything it pulls in) out of every turn.
     */
    forwardSystemPrompt?: boolean;
    /** Node executable that runs the ZCode entry script. */
    nodePath?: string;
    /** ZCode CLI entry script (`resources/glm/zcode.cjs`). */
    zcodeCjsPath?: string;
    /**
     * Backstop for one ZCode child process: the ceiling on total wall time. Only
     * a process whose output *never stops* can reach it, because the idle
     * watchdog below decides every normal case.
     */
    timeoutMs?: number;
    /**
     * Inactivity budget for one ZCode child process: killed when no stdout/stderr
     * output arrives for this long. Re-armed on every chunk, so a long reasoning
     * step is never mistaken for a hang. MUST stay below `timeoutMs`: both timers
     * are armed inside the same process, so a wall clock that expires first makes
     * this watchdog unreachable and every healthy long turn dies as `timeout`.
     */
    idleTimeoutMs?: number;
    /**
     * How the request pipe is retired after the prompt is written. `-p` is a
     * one-shot prompt, so `hold` keeps stdin open until the child exits and
     * `close` ends it as soon as the prompt is written.
     */
    stdinMode?: 'hold' | 'close';
    /** Max concurrent ZCode processes. */
    maxConcurrent?: number;
    /** Max queue length in front of the concurrency gate. */
    maxQueue?: number;
    /** Queue timeout ms. */
    queueTimeoutMs?: number;
    /** Max captured stdout bytes before the process is killed as `output-limit`. */
    maxOutputBytes?: number;
    /** Max length of one stdout event line. */
    maxEventLineLength?: number;
    /** Retry policy consumed by the DSH retry executor. */
    retryPolicy?: ZcodeRetryPolicyConfig;
}
export declare const ZCODE_RETRYABLE_CODES: readonly ["RATE_LIMIT", "TIMEOUT", "ZCODE_EXIT", "ZCODE_UNKNOWN"];
export type ZcodeRetryableCode = typeof ZCODE_RETRYABLE_CODES[number];
/** Static catalog verified against ZCode 0.17.0's configured providers. */
export declare const DEFAULT_MODELS: readonly ModelConfig[];
/** Default model id handed to ZCode when a request does not override it. */
export declare const DEFAULT_MODEL = "GLM-5.3-Flash";
/** Measured Node major floor: `node:sqlite` (used by ZCode 0.17.0) needs >= 22. */
export declare const DEFAULT_NODE_PATH: string;
/** Verified ZCode CLI entry script for 0.17.0. */
export declare const DEFAULT_ZCODE_CJS_PATH: string;
export declare function createConfigSchema(defaults?: {
    enabled?: boolean;
    toolPolicy?: ZcodeToolPolicy;
}): z<Config>;
/** Programmatic library default: enabled=false, toolPolicy=reject. */
export declare const Config: z<Config>;
/** Bundle default for DSH profile plugin add: enabled=true, tools rejected. */
export declare const BundleConfig: z<Config>;
/**
 * Read a boolean config value that may be a volatile reference.
 *
 * `enabled` carries `.volatile()` so a settings change takes effect without a
 * restart. The host then hands `apply()` the reference object rather than the
 * primitive, and `reference === true` is *always* false — the exact bug that
 * kept the adapter unregistered. Both shapes are accepted here: a primitive
 * (programmatic config, tests) and any reference exposing a callable `get()`.
 */
export declare function configBoolean(value: unknown): boolean;
/**
 * Like {@link configBoolean}, but an absent value takes `fallback`.
 *
 * Needed for flags that default to *on*: `configBoolean(undefined)` is `false`,
 * which would silently invert the documented default when a programmatic config
 * omits the key.
 */
export declare function configFlag(value: unknown, fallback: boolean): boolean;
/**
 * Resolve the effective catalog. Catalog membership is advisory; unknown exact
 * model ids remain valid request targets and are handled by the adapter's
 * resolveModel().
 */
export declare function configuredModels(config?: {
    readonly model?: string | undefined;
    readonly models?: readonly ModelConfig[] | undefined;
}): readonly ModelConfig[];
/** Filter catalog by visibleModels (empty = all). */
export declare function filterVisibleModels(models: readonly ModelConfig[], visibleModels: readonly string[] | undefined): readonly ModelConfig[];
//# sourceMappingURL=config.d.ts.map