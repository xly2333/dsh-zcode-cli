/**
 * ZCode provider adapter: one DSH route backed by the locally installed ZCode CLI.
 *
 * The CLI is the model. This adapter never speaks the upstream HTTP protocol —
 * it starts one `zcode.cjs` process per model call, hands it the whole turn as a
 * single `-p` prompt, and projects the stdout frames back onto DSH's
 * `StreamChunk` vocabulary. Everything provider-specific therefore lives in the
 * process layer (`../zcode/process.ts`) and the frame recognizer
 * (`../zcode/parser.ts`); this file owns the three things that cannot live
 * there: the message projection, the session binding, and the terminal frame
 * order.
 *
 * ## Why the prompt is one string
 *
 * ZCode 0.17.0 documents exactly one input channel for a one-shot turn: `-p
 * <prompt>`. There is no stdin protocol, no `--input-format json`, no `--model`.
 * So `sessionMode: 'full'` renders the entire DSH history into that one string,
 * each turn. Two consequences are real and are handled explicitly rather than
 * papered over:
 *
 * - **Windows caps one command line at 32767 characters.** A long history
 *   therefore cannot be sent through argv. Rather than truncate (which would
 *   silently drop the middle of a conversation and produce an answer about the
 *   wrong context), this adapter fails closed above
 *   {@link PROMPT_ARGV_MAX_CHARS} with an explicit diagnostic.
 * - **Nothing survives the process.** Every call is a fresh session unless
 *   `sessionMode: 'resume'` reuses a `sess_…` id, so the "conversation" the CLI
 *   sees is exactly the text this adapter builds.
 *
 * ## Frame order (hard contract)
 *
 * `block-start(text)? → text-delta* → block-end(text)? → usage? → finish`.
 *
 * `finish` is always the last chunk, on every path including failures, and a
 * started block is always closed before it. The adapter therefore never throws
 * out of `stream()`: a thrown error would leave the runtime to synthesize a
 * terminal frame, and a synthesized frame loses the provider facts (code,
 * providerCode, request-id) this file already holds in hand.
 *
 * ## Tool policy and unsupported request fields (fail-closed)
 *
 * `toolPolicy` decides what happens to the DSH-owned part of a request; it never
 * decides whether a tool *request* is honored, because a headless `--mode
 * guarded` process has no approval channel and cannot honor one:
 *
 * Sampling fields (`temperature`/`maxTokens`/`stop`) apply to the `-p` route
 * only: the app-server protocol has no such fields, and DSH web sends defaults
 * on every turn, so the free-plan route drops them silently instead of
 * refusing the request.
 *
 * | policy | request carries `tools` | `temperature`/`maxTokens`/`stop` (-p route) | image/file block | a tool-shaped stdout frame |
 * | --- | --- | --- | --- | --- |
 * | `reject` | refused before spawn: `UNSUPPORTED_TOOLS` | refused before spawn: `UNSUPPORTED_OPTION` | refused before spawn: `UNSUPPORTED_CONTENT` | child killed; `PERMISSION_REQUIRED` or `UNSUPPORTED_TOOLS` |
 * | `zcode-owned` | schemas dropped, turn proceeds | refused before spawn: `UNSUPPORTED_OPTION` | projected to placeholder text | child killed; `PERMISSION_REQUIRED` or `UNSUPPORTED_TOOLS` |
 * | `dsh-owned` | refused before spawn: `UNSUPPORTED_TOOLS` | refused before spawn: `UNSUPPORTED_OPTION` | projected to placeholder text | unreachable |
 *
 * `dsh-owned` is refused up front because this route has no way to hand a tool
 * call back to DSH: the CLI prints tool progress as terminal text and exits, so
 * projecting a call would either drop it or run the tool twice.
 *
 * `temperature`, `maxTokens` and `stop` have no place in ZCode 0.17.0's
 * one-shot argv form, so accepting them and dropping them silently would let a
 * caller believe a sampling setting took effect. They are refused under every
 * policy, before the process starts.
 *
 * ## Session binding
 *
 * `SessionRegistry` holds a per-conversation serial lock. A turn on conversation
 * A never waits for conversation B, but two turns on A are strictly serial, so a
 * `--resume sess_…` id can never be used twice at once. The session id itself is
 * remembered from stdout (`sess_…`) and persisted through `FileSessionStore`;
 * when the CLI prints no id, nothing is remembered and `resume` simply stays
 * unavailable — this adapter never invents an id.
 *
 * Auxiliary calls (`purpose: 'compaction' | 'session-title'`) bypass both the
 * lock and the session map: they are not the conversation, they must not
 * consume its `--resume` id, and they must not queue behind a long turn.
 *
 * ## Registered deviations from `design.md`
 *
 * - **D-a** The error table maps "tool call in `reject` mode" to
 *   `UNSUPPORTED_TOOLS` and "approval needed" to `PERMISSION_REQUIRED`, while
 *   the B5 checklist names `PERMISSION_REQUIRED` for both. The table wins
 *   because the two events need different fixes; both remain fail-closed.
 * - **D-b** A failed `--resume` attempt does not silently retry in full mode.
 *   Each attempt spends a real quota unit, and `resume` is unverified (see
 *   `tasks.md` recovery condition 2). The stale record is dropped instead, so
 *   the next turn starts clean.
 * - **D-c** Image and file blocks are projected to placeholder text rather than
 *   rejected, except under `toolPolicy: 'reject'`: that policy promises to refuse
 *   anything this route cannot carry, so a reject-mode request carrying an image
 *   or file block fails with `UNSUPPORTED_CONTENT` before the process starts. A
 *   text-only route is exactly what `imageInput: 'off'` means for the permissive
 *   policies, and DSH itself renders offloaded images the same way.
 *
 * ## Unresolved
 *
 * - `toolPolicy` cannot switch off the ZCode CLI's own tool surface: `--mode
 *   guarded` is delegated to the CLI, whose headless behavior is unverified (the
 *   subscription quota expired before a live run). This adapter refuses the DSH
 *   tool schema; it does not and cannot prove that the CLI ran no tool of its own.
 * - The turn is one `-p` argv entry, so the full prompt is visible in the child's
 *   command line to any local process able to read it (inherent to `-p`).
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm';
import { type Config } from './config.js';
import { ZcodeError, isZcodeError } from './error-codes.js';
/** Display name of the provider card; the route id is `providerInfo().id`. */
export declare const ZCODE_PROVIDER_DISPLAY_NAME = "ZCode CLI";
/**
 * Diagnostic path handed to `resolveRetryPolicy()`.
 *
 * It names the configuration section that owns the value, so an invalid policy
 * is reported against something the user can actually edit.
 */
export declare const ZCODE_CONFIG_PATH = "dsh-zcode-cli";
/**
 * Ceiling on the rendered prompt, in characters.
 *
 * Windows caps a whole command line at 32767 characters, and the prompt is one
 * argv entry. The budget leaves room for the node path, the entry script, the
 * fixed flags and a resumed session id. Exceeding it fails the call instead of
 * truncating the history: a truncated prompt silently answers a different
 * question than the one asked.
 */
export declare const PROMPT_ARGV_MAX_CHARS = 30000;
/** Prompt length above which the adapter records a diagnostic. */
export declare const PROMPT_ARGV_WARN_CHARS = 24000;
/** Diagnostic sink handed in by the bundle entry (`src/index.ts`). */
/**
 * The live selection the settings card writes, as the bundle entry hands it in.
 *
 * Deliberately a structural type instead of `ZcodeSelectionState` from
 * `src/selection.ts`: importing that module would drag the selection store's
 * filesystem dependencies into the adapter's module graph, and the adapter
 * tests must be able to run with no filesystem at all.
 */
export interface ZcodeSelectionLike {
    /** Transport selector: "free" runs the app-server channel, anything else the one-shot `-p` subprocess. */
    readonly plan?: string | undefined;
    /** The model the card picked; the CLI honours it, `plan` and `effort` do not. */
    readonly model?: string | undefined;
    /** No CLI flag exists for it, so it never changes a spawned command. */
    readonly effort?: string | undefined;
}
export interface ZcodeAdapterDeps {
    /** One structured record per event; the entry serializes it to a log line. */
    readonly logger: (record: unknown) => void;
    /**
     * Resolve the working directory of the session's workspace.
     *
     * The host owns this knowledge: `GenerateOptions` carries no workspace, so the
     * bundle entry closes over `sessions` and `workspaceRegistry` and hands the
     * resolved root in. Returning `undefined` is a hard failure, never a fallback
     * to `process.cwd()` (which is the DSH install directory, not the user's
     * project).
     */
    readonly resolveWorkspaceRoot?: ((conversationId: string | undefined) => Promise<string | undefined>) | undefined;
    /**
     * Read the settings card's live choice, once per turn.
     *
     * Called at the top of `stream`, before the model guard: a card pick is how
     * this route switches between the models in its catalog, since the CLI has no
     * `--model` flag of its own. Returning `undefined` means "the card has not
     * written a selection", and every field falls back to the configured value.
     */
    readonly getSelection?: (() => ZcodeSelectionLike | undefined) | undefined;
    /**
     * Resolve the live MCP tool bridge, per turn.
     *
     * A lookup rather than a value: the bridge starts asynchronously while the
     * plugin loads, so a value captured at construction would stay `undefined`
     * for the whole host lifetime. Returning `undefined` simply means the CLI
     * sees its own built-in tools only.
     */
    readonly resolveMcpBridge?: (() => ZcodeMcpBridgeLike | undefined) | undefined;
}
/** The slice of `src/mcp/bridge.ts` the adapter consumes. */
export interface ZcodeMcpBridgeLike {
    readonly active: boolean;
    /** `session/create.mcpServers` entries; empty when the bridge is not live. */
    readonly mcpServers: () => readonly {
        readonly name: string;
        readonly type: 'http';
        readonly url: string;
        readonly headers: ReadonlyArray<{
            readonly name: string;
            readonly value: string;
        }>;
    }[];
    /** Point the bridge at the DSH session owning the next ZCode turn. */
    readonly setSession: (sessionId: string) => void;
}
/**
 * The DSH adapter for ZCode.
 *
 * One instance owns one provider route. The session registry and the retry
 * policy are captured at construction time, like the retry-policy contract
 * requires ("immutable provider policy captured when its adapter route is
 * registered"), so a settings change can only take effect through a new
 * adapter — never by swapping a policy under an in-flight turn.
 */
export declare class ZcodeAdapter extends LlmAdapter {
    private readonly config;
    private readonly logger;
    private readonly provider;
    private readonly model;
    private readonly catalog;
    private readonly toolPolicy;
    private readonly processConfig;
    private readonly sessions;
    private readonly retryPolicy;
    private readonly resolveWorkspaceRoot;
    private readonly getSelection;
    private readonly resolveMcpBridge;
    constructor(config: Config, deps: ZcodeAdapterDeps);
    /** The retry policy captured with this route. */
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
    /**
     * Advertise the configured catalog.
     *
     * `visibleModels` is applied here and not in the request path: a model the
     * selector hides is still addressable by id, because a hidden entry is a UI
     * preference, not a capability statement.
     */
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    /**
     * Resolve one exact model.
     *
     * Resolution is metadata, never admission: the host builds the browser catalog
     * by resolving *every* advertised model, and one throw demotes the whole
     * provider into `failures` — which is exactly how a provider disappears from
     * the model picker. So a model that this route cannot actually run still
     * resolves here, and the turn refuses it with `MODEL_NOT_FOUND` instead
     * (`stream`). Only an id outside the advertised catalog throws.
     */
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * Run one turn through a ZCode process.
     *
     * The generator never throws: every failure is reported as a terminal
     * `finish` chunk carrying the DSH-visible code, so the caller always sees the
     * provider facts this adapter collected.
     */
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk, void, void>;
    /**
     * One turn over the ZCode app-server (start-plan).
     *
     * The wire carries the same account providers the desktop client injects, so
     * the CLI signs its own requests and no credential of this adapter ever
     * leaves the machine. Frames project 1:1 onto StreamChunks: a thinking run
     * opens a `reasoning` block before the text block, usage precedes finish,
     * and every failure surfaces as the same DSH-visible codes the `-p` route
     * uses.
     */
    private streamFreeTurn;
    private streamTurn;
    /**
     * Map one tool-shaped frame onto the fail-closed code that fits it.
     *
     * `permission` means the CLI needs an approval, `tool-call` means the model
     * asked for a tool this route never advertised. They need different fixes,
     * so they get different codes (registered deviation D-a).
     */
    private toolFailure;
    /**
     * Remember a provider-side quota rejection for the diagnostics surface.
     *
     * Recording only: the failure keeps travelling through {@link toLlmFailure}
     * into the terminal `finish` chunk exactly as before, and this cannot throw —
     * the diagnostics layer holds one module-level record. Without this call
     * `doctor`'s `last-quota` check could only ever say "nothing observed in this
     * process", even right after a real 1309.
     */
    private noteQuotaObservation;
    /**
     * Pre-spawn admission: refuse what this route cannot honor instead of letting
     * the CLI ignore it. Every branch here runs before `runZcode`, so a refused
     * request never spends a quota unit or leaves a process behind.
     */
    private admissionFailure;
    /**
     * Ask the host for the session workspace root.
     *
     * A missing resolver, a missing session, a deleted directory or a throwing
     * registry all collapse to `undefined`; the caller fails closed with
     * `WORKSPACE_UNAVAILABLE` rather than guessing a directory.
     */
    private resolveCwd;
    /** Map a process-layer failure, keeping a caller cancellation distinguishable. */
    private processFailure;
    /**
     * Drop the remembered session id after a failure that means the id is dead.
     *
     * A dead id fails identically on the next attempt, and retrying it in full
     * mode would spend another quota unit on a guess (registered deviation D-b).
     * Dropping the record lets the next turn start clean — logging alone left
     * resume mode reusing the dead id forever. Shared by both routes: the
     * app-server channel fails its `session/resume` with the same codes.
     */
    private forgetStaleSession;
    private remember;
    private modelInfo;
    /**
     * Filter the configured retry allowlist down to the codes this route can
     * actually produce, falling back to the defaults when nothing survives.
     */
    private retryableCodes;
    /**
     * Render the request as the single prompt string the CLI accepts.
     *
     * `resume` narrows the scope to the messages produced after this route's own
     * last assistant message: the resumed ZCode session already holds everything
     * up to and including that answer, so resending it would duplicate the whole
     * conversation inside the model's context.
     */
    private buildPrompt;
    /** Messages after this route's last assistant answer; the whole list when there is none. */
    private turnAfterOwnAssistant;
}
/** Re-export so consumers of this module need one import for the error type. */
export { ZcodeError, isZcodeError };
//# sourceMappingURL=zcode.d.ts.map