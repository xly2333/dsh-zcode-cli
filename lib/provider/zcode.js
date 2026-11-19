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
import { EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, resolveRetryPolicy, } from '@deepseek-ai/dsh-llm';
import { DEFAULT_MODEL, DEFAULT_MODELS, DEFAULT_NODE_PATH, DEFAULT_ZCODE_CJS_PATH, ZCODE_RETRYABLE_CODES, configuredModels, configFlag, filterVisibleModels, } from './config.js';
import { ZcodeError, boundDiagnostic, isZcodeError, isZcodeErrorCode } from './error-codes.js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { QUOTA_PROVIDER_CODE, recordQuotaObservation } from '../diagnostics.js';
import { FileSessionStore, sessionStorePath } from '../session/file-store.js';
import { SessionRegistry } from '../session/store.js';
import { ENV_NAME_PATTERN, NODE_OPTIONS_REQUIRED, ZCODE_ENV_ALLOWLIST, resolveNodeOptions, runZcode, } from '../zcode/process.js';
import { ZcodeStreamParser, parseStdout } from '../zcode/parser.js';
import { buildZcodeAccountConfig } from '../zcode/account-config.js';
import { runZcodeAppServerTurn } from '../zcode/app-server.js';
import { readZcodePlanToken } from '../zcode/credential.js';
import { ZCODE_EFFORT_IDS, ZCODE_MODEL_IDS } from '../selection.js';
/** Display name of the provider card; the route id is `providerInfo().id`. */
export const ZCODE_PROVIDER_DISPLAY_NAME = 'ZCode CLI';
/**
 * Diagnostic path handed to `resolveRetryPolicy()`.
 *
 * It names the configuration section that owns the value, so an invalid policy
 * is reported against something the user can actually edit.
 */
export const ZCODE_CONFIG_PATH = 'dsh-zcode-cli';
/**
 * Ceiling on the rendered prompt, in characters.
 *
 * Windows caps a whole command line at 32767 characters, and the prompt is one
 * argv entry. The budget leaves room for the node path, the entry script, the
 * fixed flags and a resumed session id. Exceeding it fails the call instead of
 * truncating the history: a truncated prompt silently answers a different
 * question than the one asked.
 */
export const PROMPT_ARGV_MAX_CHARS = 30_000;
/** Prompt length above which the adapter records a diagnostic. */
export const PROMPT_ARGV_WARN_CHARS = 24_000;
/**
 * How much stdout one turn keeps for the whole-segment recovery pass.
 *
 * The live path is line-incremental, so this buffer exists only for the case
 * where the CLI printed one pretty-printed JSON document: no single line of it
 * parses, and the answer would otherwise be reported as `ZCODE_PARSE`. The cap
 * is 64 KiB — far beyond any answer this route can carry through argv, and
 * small enough that a runaway child cannot grow it without bound.
 */
const STDOUT_RECOVERY_MAX_CHARS = 64 * 1024;
/**
 * Last-resort parse of the whole capture.
 *
 * Returns `undefined` on any parse failure: the caller's fail-closed branch is
 * the authority, and this pass may not turn a broken capture into a success.
 */
function recoverWholeSegment(capture) {
    try {
        const parsed = parseStdout(capture);
        return parsed.text.length > 0 ? parsed.text : undefined;
    }
    catch {
        return undefined;
    }
}
    /** This route carries text only; images and files are projected to text. */
    const TEXT_ONLY = ['text'];
    /** 图片输入通道(2026-11-18 接通):app-server session/send attachments。 */
    const IMAGE_AND_TEXT = ['text', 'image'];
/**
 * Fallbacks that mirror the defaults in `./config.ts`.
 *
 * The config schema already applies them, but an adapter can also be
 * constructed directly (tests, tools), and a missing timeout must never mean
 * "no timeout".
 */
const PROCESS_DEFAULTS = {
    timeoutMs: 900_000,
    idleTimeoutMs: 300_000,
    maxOutputBytes: 8 * 1024 * 1024,
    maxEventLineLength: 1_048_576,
    maxConcurrent: 4,
    maxQueue: 32,
    queueTimeoutMs: 30_000,
    stdinMode: 'hold',
};
/**
 * The DSH adapter for ZCode.
 *
 * One instance owns one provider route. The session registry and the retry
 * policy are captured at construction time, like the retry-policy contract
 * requires ("immutable provider policy captured when its adapter route is
 * registered"), so a settings change can only take effect through a new
 * adapter — never by swapping a policy under an in-flight turn.
 */
export class ZcodeAdapter extends LlmAdapter {
    config;
    logger;
    provider;
    model;
    catalog;
    toolPolicy;
    processConfig;
    sessions;
    retryPolicy;
    resolveWorkspaceRoot;
    getSelection;
    resolveMcpBridge;
    constructor(config, deps) {
        super();
        this.config = config;
        this.logger = debugTee(deps.logger);
        this.resolveWorkspaceRoot = deps.resolveWorkspaceRoot;
        this.getSelection = deps.getSelection;
        this.resolveMcpBridge = deps.resolveMcpBridge;
    // 图片输入通道(2026-11-18):DSH 附件引用 → 宿主绝对路径,随 session/send 携带。
    this.resolveAttachmentHostPath = deps.resolveAttachmentHostPath;
        this.provider = nonEmpty(config.provider) ?? 'zcode';
        this.model = nonEmpty(config.model) ?? DEFAULT_MODEL;
        // One catalog builder for both the adapter and the test/tool surface: the
        // configured `model` is merged in even when `models` omits it, so a profile
        // that sets only `model` never fails `resolveModel` with MODEL_NOT_FOUND.
        this.catalog = configuredModels({ model: config.model, models: config.models ?? DEFAULT_MODELS });
        this.toolPolicy = config.toolPolicy ?? 'dsh-owned';
        this.processConfig = {
            nodePath: nonEmpty(config.nodePath) ?? DEFAULT_NODE_PATH,
            zcodeCjsPath: nonEmpty(config.zcodeCjsPath) ?? DEFAULT_ZCODE_CJS_PATH,
            timeoutMs: config.timeoutMs ?? PROCESS_DEFAULTS.timeoutMs,
            idleTimeoutMs: config.idleTimeoutMs ?? PROCESS_DEFAULTS.idleTimeoutMs,
            stdinMode: config.stdinMode ?? PROCESS_DEFAULTS.stdinMode,
            maxOutputBytes: config.maxOutputBytes ?? PROCESS_DEFAULTS.maxOutputBytes,
            maxEventLineLength: config.maxEventLineLength ?? PROCESS_DEFAULTS.maxEventLineLength,
            maxConcurrent: config.maxConcurrent ?? PROCESS_DEFAULTS.maxConcurrent,
            maxQueue: config.maxQueue ?? PROCESS_DEFAULTS.maxQueue,
            queueTimeoutMs: config.queueTimeoutMs ?? PROCESS_DEFAULTS.queueTimeoutMs,
        };
        const store = new FileSessionStore(sessionStorePath(config.sessionStorePath, process.env));
        this.sessions = new SessionRegistry(store);
        this.retryPolicy = resolveRetryPolicy({
            mode: 'normal',
            maxRetries: config.retryPolicy?.maxRetries ?? 2,
            retryableCodes: this.retryableCodes(),
            backoff: { initialDelayMs: config.retryPolicy?.backoffMs ?? 1_000 },
        }, ZCODE_CONFIG_PATH);
    }
    /** The retry policy captured with this route. */
    providerInfo(provider) {
        return { id: provider, name: ZCODE_PROVIDER_DISPLAY_NAME };
    }
    providerRetryPolicy(_provider) {
        return this.retryPolicy;
    }
    /**
     * Advertise the configured catalog.
     *
     * `visibleModels` is applied here and not in the request path: a model the
     * selector hides is still addressable by id, because a hidden entry is a UI
     * preference, not a capability statement.
     */
    async listModels(provider) {
        return filterVisibleModels(this.catalog, this.config.visibleModels)
            .map(entry => this.modelInfo(provider, entry));
    }
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
    async resolveModel(provider, model, _signal) {
        const entry = this.catalog.find(candidate => candidate.id === model);
        if (entry === undefined) {
            throw new LlmError(`ZCode does not advertise model "${model}"; the configured catalog is ${this.catalog.map(item => item.id).join(', ')}`, 'MODEL_NOT_FOUND');
        }
        const info = this.modelInfo(provider, entry);
        return {
            ...info,
            ...(entry.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } }),
        };
    }
    /**
     * Run one turn through a ZCode process.
     *
     * The generator never throws: every failure is reported as a terminal
     * `finish` chunk carrying the DSH-visible code, so the caller always sees the
     * provider facts this adapter collected.
     */
    async *stream(options) {
        // The card's live choice, read once per turn. `plan` selects the transport
        // (streamTurn routes "free" to the app-server channel); within the -p route
        // the command line is identical for both plans — the CLI has no --effort
        // flag, and the account ZCode signs its own requests with comes from ZCode's
        // own state files, not from this selection.
        const selection = this.getSelection?.();
        const selectedModel = nonEmpty(selection?.model);
        const model = selectedModel ?? this.model;
        // 2026-11-18 修复:free 路由(app-server)的 session/send 自带 modelSelection,
        // 能按轮选择目录内任意模型(ZCODE_MODEL_IDS 本来就有 GLM-5.3);只有 -p 路由
        // (CLI 无 --model)才必须钉死在配置模型上。原先一刀切把非 selection 模型判死,
        // 导致钉在 GLM-5.3 的会话直接 MODEL_NOT_FOUND。
        const requestedModel = nonEmpty(options.model);
        const freeRoute = nonEmpty(selection?.plan) === 'free';
        const catalogIds = new Set((Array.isArray(this.catalog) ? this.catalog : [])
            .map((entry) => entry?.id)
            .filter((id) => typeof id === 'string'));
        catalogIds.add(model);
        let turnModel = model;
        if (requestedModel !== undefined && requestedModel !== model) {
            if (!(freeRoute && catalogIds.has(requestedModel))) {
                // The cli route has no `--model` flag, so a requested model it cannot
                // honor fails here — at the turn — rather than in `resolveModel`, which
                // must advertise every listed model or the host drops the provider
                // from the picker.
                yield {
                    type: 'finish',
                    reason: {
                        kind: 'error',
                        failure: {
                            code: 'MODEL_NOT_FOUND',
                            message: `ZCode 0.17.0 has no --model flag, so the -p route can only run the configured model "${model}"; `
                                + `"${requestedModel}" cannot be selected there. Free-plan turns may use any catalog model.`,
                        },
                    },
                };
                return;
            }
            turnModel = requestedModel;
        }
        const turnOptions = turnModel === options.model
            ? options
            : { ...options, model: turnModel };
        const conversationId = options.sessionId === undefined ? undefined : String(options.sessionId);
        const auxiliary = options.purpose !== undefined;
        const shared = conversationId !== undefined && !auxiliary;
        const release = shared ? await this.sessions.acquire(conversationId) : undefined;
        try {
            yield* this.streamTurn(turnOptions, conversationId, shared);
        }
        finally {
            release?.();
        }
    }
    // -------------------------------------------------------------------------
    // Free-plan turn (app-server channel)
    // -------------------------------------------------------------------------
    /** per-conversation 串行门:同一会话的 free 轮次严格排队,跨会话并行。 */
    freeTurnChains;
    async *enqueueFreeTurn(options, conversationId, shared) {
        const key = String(conversationId ?? 'adhoc');
        const chains = (this.freeTurnChains ??= new Map());
        const prev = chains.get(key) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        chains.set(key, prev.then(() => gate, () => gate));
        // 等上一轮彻底完成(含其 generator 耗尽)才进入本轮。
        await prev.catch(() => { });
        try {
            yield* this.streamFreeTurn(options, conversationId, shared);
        }
        finally {
            release();
            if (chains.get(key) === gate)
                chains.delete(key);
        }
    }
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
    async *streamFreeTurn(options, conversationId, shared) {
        const startedAt = Date.now();
        const dataBaseDir = zcodeDataBaseDir();
        const selection = this.getSelection?.();
        const model = nonEmpty(options.model) ?? this.model;
        const effort = effortId(selection?.effort) ?? 'max';
        const emitFinish = (failure, usage, characters, zcodeSessionId) => {
            this.logger({
                kind: failure === undefined ? 'zcode.request.completed' : 'zcode.request.failed',
                provider: this.provider,
                model,
                transport: 'app-server',
                toolPolicy: this.toolPolicy,
                sharedSession: shared,
                conversationId,
                purpose: options.purpose,
                durationMs: Date.now() - startedAt,
                characters,
                zcodeSessionId,
                code: failure?.code,
                ...(failure === undefined ? {} : { message: failure.message }),
                toolSchemas: options.tools?.length ?? 0,
                usage,
            });
            const chunks = [];
            if (usage !== undefined)
                chunks.push({ type: 'usage', usage });
            chunks.push({
                type: 'finish',
                reason: failure === undefined ? { kind: 'stop' } : { kind: 'error', failure },
            });
            return chunks;
        };
        // Admission: `reject` still refuses up front (that is what the policy asks
        // for). `dsh-owned` cannot be projected back on this route, so it degrades
        // to the closest honourable behaviour: the schemas are dropped and ZCode
        // runs its own tools, with one honest warning line per turn. Silently
        // pretending DSH tools were available would answer a different request.
        const toolCount = options.tools?.length ?? 0;
        if (toolCount > 0 && this.toolPolicy === 'reject') {
            yield {
                type: 'finish',
                reason: {
                    kind: 'error',
                    failure: {
                        code: 'UNSUPPORTED_TOOLS',
                        message: `toolPolicy "reject" refuses ${toolCount} declared tool schema(s) on the free-plan route. `
                            + 'Use "zcode-owned" or "dsh-owned" (which degrades to zcode-owned here) to proceed.',
                    },
                },
            };
            return;
        }
        if (toolCount > 0 && this.toolPolicy === 'dsh-owned') {
            this.logger({
                kind: 'zcode.free-plan.degraded',
                detail: `dsh-owned cannot project tool calls on the app-server route; ${toolCount} schema(s) dropped, `
                    + 'ZCode runs its own tools for this turn (zcode-owned semantics)',
            });
        }
        if (this.toolPolicy === 'reject') {
            const media = countMediaBlocks(options.messages);
            if (media > 0) {
                yield {
                    type: 'finish',
                    reason: {
                        kind: 'error',
                        failure: {
                            code: 'UNSUPPORTED_CONTENT',
                            message: `toolPolicy "reject" refuses ${media} image/file block(s) before the session opens: `
                                + 'reject promises to refuse anything this route cannot carry, and a text-only projection of an '
                                + 'attachment answers a different question. Use "zcode-owned" or "dsh-owned" for placeholder text.',
                        },
                    },
                };
                return;
            }
        }
        // DSH web sends default temperature/maxTokens on every turn. The app-server
        // protocol has no such fields, so they are dropped here and the CLI's own
        // defaults apply: refusing would fail every turn over a field this route
        // cannot carry anyway.
        // Session lookup happens before the prompt is built, mirroring the `-p`
        // route: a resumed ZCode session already holds everything up to its last
        // answer, so the prompt narrows to the new turn instead of replaying the
        // whole history into a context that already has it.
        const recorded = shared && conversationId !== undefined ? this.sessions.get(conversationId) : undefined;
        const resume = this.config.sessionMode === 'resume' && recorded !== undefined;
        const resumeSessionId = resume && recorded !== undefined ? recorded.sessionId : undefined;
        // 2026-11-18:图片通道打开时收集可携带的图片宿主路径,真实附件随 turn 传递。
        const imageSink = this.imageInputMode()
            ? { imagePaths: [], imagePathOf: (ref) => this.resolveAttachmentHostPath?.(ref) }
            : undefined;
        const prompt = this.buildPrompt(options, resume, imageSink);
        let account;
        try {
            account = buildZcodeAccountConfig({
                builtinPath: zcodeBuiltinPath(),
                // 2026-11-17:桌面端真实轮次的 providerId 是 account:zai-start-plan
                //(rollout 实录),注入 zai 账号上下文与 planToken(JWT user_id)对齐;
                // bigmodel 上下文会被上游判为 "unusual activity"。
                accountType: 'zai',
                mode: 'start-plan',
                modelIds: ZCODE_MODEL_IDS,
            });
        }
        catch (error) {
            yield {
                type: 'finish',
                reason: {
                    kind: 'error',
                    failure: {
                        code: 'ZCODE_ENV_MISSING',
                        message: 'The start-plan account table could not be built from the built-in provider config: '
                            + (error instanceof Error ? error.message : String(error)),
                    },
                },
            };
            return;
        }
        // Tool ownership wiring, resolved once per turn so a settings reload or a
        // late-bound bridge port is picked up without a restart.
        //
        // `mcpServers` is offered only when the policy actually promises host-side
        // execution (`dsh-owned`) and the operator left the bridge on: handing the
        // CLI a bridge while `zcode-owned` would contradict the declared policy.
        const bridge = this.resolveMcpBridge?.();
        const bridgeLive = configFlag(this.config.mcpBridge, true)
            && this.toolPolicy === 'dsh-owned'
            && bridge?.active === true;
        const mcpServers = bridgeLive && bridge !== undefined ? [...bridge.mcpServers()] : [];
        const toolAllowlist = [...(this.config.toolAllowlist ?? [])];
        const toolDenylist = [...(this.config.toolDenylist ?? [])];
        // Point the endpoint at *this* conversation before the turn starts, and
        // clear it when there is no DSH session: leaving the previous handle in
        // place would resolve the wrong agent and run the tools on the wrong plane.
        if (bridgeLive)
            bridge?.setSession(conversationId ?? '');
        const appServerDeps = {
            nodePath: this.processConfig.nodePath,
            zcodeCjsPath: this.processConfig.zcodeCjsPath,
            env: freePlanEnv(this.config.passEnv ?? [], configFlag(this.config.isolatedHome, true)),
            workspacePath: await this.resolveCwd(conversationId) ?? '.',
            workspaceKey: conversationId ?? 'adhoc',
            planToken: () => readZcodePlanToken(dataBaseDir),
            logger: (record) => this.logger(record),
            timeoutMs: this.processConfig.timeoutMs,
            // 复用进程挂死兜底:90 秒无任何帧输出即中止,而不是无限等
            // (CLI 空闲自退/管道断裂时,300s 的等待对用户来说就是"无法停止")。
            // 2026-11-18:45s → 90s——图片轮次上游视觉推理/编码可能静默超 45s,
            // 45s 兜底会误杀正常轮次;90s 仍远小于旧行为的 300s。
            idleTimeoutMs: 90_000,
            permissionMode: this.config.mode,
            // Deliberately NOT `this.processConfig.maxOutputBytes`: the 8MB schema
            // default belongs to the one-shot `-p` JSON stream. The app-server route
            // replays state/telemetry envelopes every turn and trips 8MB on long
            // conversations (field report 2026-10-25, twice: "output exceeded
            // 8388608 bytes"). Leaving this unset lets app-server's own 256MB valve
            // apply — it guards a runaway child, not a turn budget.
            ...(mcpServers.length === 0 ? {} : { mcpServers }),
            ...(toolAllowlist.length === 0 ? {} : { toolAllowlist }),
            ...(toolDenylist.length === 0 ? {} : { toolDenylist }),
        };
        const textParts = [];
        const reasoningParts = [];
        let usage;
        let textOpen = false;
        let reasoningOpen = false;
        let blockIndex = 0;
        let zcodeSessionId = '';
        let failure;
        // 流式消费(2026-11-17):帧一到就投影成 StreamChunk 入队,与 -p 路线的
        // queue/wake 模式一致;thinking 块实时可见,不再等 terminal 一次性返回。
        const queue = [];
        let wake;
        const emit = (chunks) => {
            if (chunks.length === 0)
                return;
            queue.push(...chunks);
            wake?.();
            wake = undefined;
        };
        const handleFrame = (frame) => {
            const text = frame.text;
            if (frame.kind === 'thinking' && typeof text === 'string' && text.length > 0) {
                if (!reasoningOpen) {
                    reasoningOpen = true;
                    emit([{ type: 'block-start', index: blockIndex, blockType: 'reasoning' }]);
                }
                reasoningParts.push(text);
                // 2026-11-19 契约修正:思考增量必须发 reasoning-delta(与 dsh-zcode-startplan
                // stream-translator 契约一致)。此前发 text-delta,宿主把思考当正文流式渲染,
                // 直到 block-end 归位才折叠成思考块。
                emit([{ type: 'reasoning-delta', index: blockIndex, text }]);
            }
            else if (frame.kind === 'text' && typeof text === 'string' && text.length > 0) {
                if (reasoningOpen) {
                    reasoningOpen = false;
                    emit([{ type: 'block-end', index: blockIndex, block: { type: 'reasoning', text: reasoningParts.join('') } }]);
                    blockIndex += 1;
                }
                if (!textOpen) {
                    textOpen = true;
                    emit([{ type: 'block-start', index: blockIndex, blockType: 'text' }]);
                }
                textParts.push(text);
                emit([{ type: 'text-delta', index: blockIndex, text }]);
            }
            else if (frame.kind === 'usage' && frame.usage !== undefined) {
                usage = {
                    inputTokens: frame.usage.inputTokens,
                    outputTokens: frame.usage.outputTokens,
                    ...(frame.usage.totalTokens === undefined ? {} : { totalTokens: frame.usage.totalTokens }),
                    ...(frame.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: frame.usage.cacheReadTokens }),
                    ...(frame.usage.cacheCreationTokens === undefined ? {} : { cacheWriteTokens: frame.usage.cacheCreationTokens }),
                };
            }
            else if (frame.kind === 'error') {
                failure ??= {
                    code: frame.errorCode !== undefined && isZcodeErrorCode(frame.errorCode) ? frame.errorCode : 'ZCODE_UNKNOWN',
                    message: frame.errorMessage ?? 'ZCode app-server reported an error',
                };
            }
        };
        let settled = false;
        let outcome;
        // runner 独立取消开关(2026-11-18):生成器提前退场(消费者中断/异常)
        // 而 runner 还在等 CLI 终端事件时,必须主动掐掉 runner——否则缓存的
        // app-server 进程里 CLI prompt 还活着,下一轮 session/send 会被
        // -32010 "A prompt is already running" 拒掉。外层 signal 转接进来,
        // 本地也可随时 abort。
        const turnAbort = new AbortController();
        const onOuterAbort = () => turnAbort.abort();
        options.signal?.addEventListener('abort', onOuterAbort, { once: true });
        try {
            outcome = runZcodeAppServerTurn(appServerDeps, account, {
                providerId: account.providerId,
                modelId: model,
                reasoningLevel: effort,
                prompt,
                ...(imageSink?.imagePaths?.length ? { attachments: imageSink.imagePaths } : {}),
                ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
                signal: turnAbort.signal,
                onFrame: handleFrame,
            }).then(r => ({ ok: true, r }), e => ({ ok: false, e }));
            void outcome.then(() => {
                // 2026-11-18 修复:runner 兑现后必须置 settled 并唤醒消费循环——
                // 否则最后一帧之后生成器永远卡在 await wake,turn 永不结束
                // (与 -p 路由的收尾逻辑同构)。
                settled = true;
                wake?.();
                wake = undefined;
            });
            while (true) {
                if (queue.length === 0) {
                    if (settled)
                        break;
                    await new Promise(resolve => {
                        wake = resolve;
                    });
                    continue;
                }
                const chunk = queue.shift();
                if (chunk !== undefined)
                    yield chunk;
            }
            const result = await outcome;
            if (result.ok) {
                zcodeSessionId = result.r.zcodeSessionId;
                if (shared && conversationId !== undefined && zcodeSessionId.length > 0) {
                    this.remember(conversationId, zcodeSessionId);
                }
                if (result.r.terminal !== 'success' && result.r.errorCode === undefined) {
                    // 2026-11-20 修复:CLI 的 failed 终端事件偶尔不带 errorCode
                    // (上游免费通道限流窗口),但 errorMessage 往往在——原实现
                    // 连它一起丢掉,只报兜底文案,把 "exceed quota limit" 这类
                    // 真实原因藏成了谜语。
                    failure ??= { code: 'ZCODE_UNKNOWN', message: result.r.errorMessage ?? 'ZCode app-server turn failed without an error code' };
                }
                else if (result.r.terminal !== 'success') {
                    failure ??= {
                        code: result.r.errorCode !== undefined && isZcodeErrorCode(result.r.errorCode) ? result.r.errorCode : 'ZCODE_UNKNOWN',
                        message: result.r.errorMessage ?? 'ZCode app-server turn failed',
                    };
                }
            }
            else {
                if (isZcodeError(result.e)) {
                    this.noteQuotaObservation(result.e);
                    failure = toLlmFailure(result.e);
                }
                else {
                    failure = {
                        code: 'ZCODE_UNKNOWN',
                        message: boundDiagnostic(`ZCode app-server turn failed: ${result.e instanceof Error ? result.e.message : String(result.e)}`),
                    };
                }
                this.forgetStaleSession(failure, resume, conversationId);
            }
            // The provider rejected the request for size, not the session: the CLI
            // session (and its remembered id) stays valid for a shorter turn.
            if (failure?.code === 'ZCODE_UNKNOWN' && /context window/i.test(failure.message)) {
                failure = {
                    code: 'ZCODE_OUTPUT_TOO_LARGE',
                    message: 'Model request exceeded the provider context window. '
                        + 'Start a new DSH session (or switch this session back to a model with a larger window) and retry.',
                };
            }
            // Short turns can skip `model.streaming` entirely; the terminal event's
            // `response` field is then the only text source (also on a failed turn —
            // a partial answer is worth showing). It is consulted only after the
            // streamed frames, so a long turn whose terminal event also carries the
            // full text is never projected twice.
            if (!textOpen && result.ok && result.r.responseText !== undefined && result.r.responseText.length > 0) {
                textOpen = true;
                yield { type: 'block-start', index: blockIndex, blockType: 'text' };
                textParts.push(result.r.responseText);
                yield { type: 'text-delta', index: blockIndex, text: result.r.responseText };
            }
        }
        catch (error) {
            // 消费者中断(yield 抛出)或意外异常:收口交由下方 block-end 段处理。
            turnAbort.abort(); // runner 可能还在跑:立刻掐掉,防缓存进程残留活 prompt
            if (isZcodeError(error) && failure === undefined) {
                this.noteQuotaObservation(error);
                failure = toLlmFailure(error);
                this.forgetStaleSession(failure, resume, conversationId);
            }
        }
        if (!settled)
            turnAbort.abort(); // 兜底:走到这里而 runner 未兑现,说明生成器被提前终止
        options.signal?.removeEventListener('abort', onOuterAbort);
        if (reasoningOpen) {
            yield { type: 'block-end', index: blockIndex, block: { type: 'reasoning', text: reasoningParts.join('') } };
            blockIndex += 1;
        }
        if (textOpen) {
            yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: textParts.join('') } };
        }
        for (const chunk of emitFinish(failure, usage, textParts.join('').length, zcodeSessionId))
            yield chunk;
    }
    // -------------------------------------------------------------------------
    // Turn assembly
    // -------------------------------------------------------------------------
    async *streamTurn(options, conversationId, shared) {
        // Free plan runs on the app-server channel: the CLI signs start-plan
        // requests itself once the account providers are injected in-process, so
        // no token or key of ours travels on the wire. Paid (and the default) keep
        // the one-shot `-p` subprocess, whose self-signing comes from the
        // personal provider config the CLI reads on its own.
        if (nonEmpty(this.getSelection?.()?.plan) === 'free') {
            // 串行门(2026-11-17):复用进程后,同一会话的主轮次与标题生成/
            // compaction 等辅助请求可能并发打到同一个 app-server 进程,
            // 帧流交叉会互相卡死 —— 与 -p 路线的 per-conversation 串行锁同构。
            yield* this.enqueueFreeTurn(options, conversationId, shared);
            return;
        }
        const startedAt = Date.now();
        const parser = new ZcodeStreamParser();
        const queue = [];
        let wake;
        let settled = false;
        let abortCause;
        let toolFrame;
        let sawUnknownFrame = false;
        // Bounded whole-capture buffer for {@link recoverWholeSegment}.
        let capture = '';
        // One internal kill switch, driven by three independent reasons: the caller
        // cancelled, a tool-shaped frame needs an approval nobody can give, or the
        // stream carried an in-band error. The process layer kills the whole tree on
        // abort, so a hung child cannot outlive the turn that gave up on it.
        const abort = new AbortController();
        const callerSignal = options.signal;
        const onCallerAbort = () => {
            abortCause ??= 'caller';
            abort.abort();
        };
        if (callerSignal?.aborted === true)
            onCallerAbort();
        else
            callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        const push = (frames) => {
            if (frames.length === 0)
                return;
            for (const frame of frames) {
                if (frame.kind === 'tool') {
                    toolFrame ??= frame;
                    abortCause ??= 'tool';
                    abort.abort();
                }
                else if (frame.kind === 'error') {
                    abortCause ??= 'in-band-error';
                    abort.abort();
                }
                else if (frame.kind === 'unknown') {
                    sawUnknownFrame = true;
                }
            }
            queue.push(...frames);
            wake?.();
            wake = undefined;
        };
        // Session lookup happens before the prompt is built: resume mode changes
        // both the argv and the prompt's own scope.
        const recorded = shared && conversationId !== undefined
            ? this.sessions.get(conversationId)
            : undefined;
        const resume = this.config.sessionMode === 'resume' && recorded !== undefined;
        let failure;
        const textParts = [];
        let usage;
        let stopReason;
        let textOpen = false;
        try {
            const prompt = this.buildPrompt(options, resume);
            failure = this.admissionFailure(options, prompt);
            const cwd = failure === undefined ? await this.resolveCwd(conversationId) : undefined;
            if (failure === undefined && cwd === undefined) {
                failure = {
                    code: 'WORKSPACE_UNAVAILABLE',
                    message: 'The session workspace root could not be resolved through the host workspace registry, '
                        + 'so this turn was not started. Running the child in the DSH install directory instead would point '
                        + 'ZCode at the wrong project; check that the session has a workspace and that it still exists.',
                };
            }
            if (failure === undefined && prompt.length > PROMPT_ARGV_WARN_CHARS) {
                this.logger({
                    kind: 'zcode.prompt.large',
                    provider: this.provider,
                    characters: prompt.length,
                    warnAt: PROMPT_ARGV_WARN_CHARS,
                    maxAt: PROMPT_ARGV_MAX_CHARS,
                });
            }
            if (failure === undefined && cwd !== undefined) {
                const run = runZcode({
                    config: this.processConfig,
                    prompt,
                    // Always the session's workspace root, never `process.cwd()`: the child
                    // resolves relative paths and edits against the project the user opened.
                    cwd,
                    passEnv: this.config.passEnv ?? [],
                    ...(resume && recorded !== undefined ? { sessionId: recorded.sessionId, resume: true } : {}),
                    signal: abort.signal,
                    onDiagnostic: (record) => this.logger(record),
                    onStdoutLine: (line) => {
                        if (capture.length < STDOUT_RECOVERY_MAX_CHARS)
                            capture += `${line}\n`;
                        push(parser.pushLine(line));
                    },
                });
                const outcome = run.then(result => ({ ok: true, result }), (error) => ({ ok: false, error }));
                void outcome.then(() => {
                    // A trailing line without a newline is held back by the parser; the
                    // process is gone, so half a frame can no longer be completed.
                    push(parser.flush());
                    settled = true;
                    wake?.();
                    wake = undefined;
                });
                while (true) {
                    if (queue.length === 0) {
                        if (settled)
                            break;
                        await new Promise(resolve => {
                            wake = resolve;
                        });
                        continue;
                    }
                    const frame = queue.shift();
                    if (frame === undefined)
                        continue;
                    switch (frame.kind) {
                        case 'text': {
                            if (frame.text.length === 0)
                                break;
                            if (!textOpen) {
                                textOpen = true;
                                yield { type: 'block-start', index: 0, blockType: 'text' };
                            }
                            textParts.push(frame.text);
                            yield { type: 'text-delta', index: 0, text: frame.text };
                            break;
                        }
                        case 'usage': {
                            usage = toTokenUsage(frame.usage);
                            break;
                        }
                        case 'session': {
                            // Remembered as soon as it is seen: a turn that fails later still
                            // leaves a reusable id, and `resume` is opt-in anyway.
                            if (shared && conversationId !== undefined)
                                this.remember(conversationId, frame.sessionId);
                            break;
                        }
                        case 'finish': {
                            if (frame.stopReason !== undefined)
                                stopReason = frame.stopReason;
                            break;
                        }
                        case 'error': {
                            // Kept for the terminal chunk; the kill switch is already armed.
                            this.noteQuotaObservation(frame.error);
                            failure ??= toLlmFailure(frame.error);
                            break;
                        }
                        default:
                            break;
                    }
                }
                const result = await outcome;
                if (failure === undefined) {
                    if (toolFrame !== undefined)
                        failure = this.toolFailure(toolFrame);
                    else if (!result.ok)
                        failure = this.processFailure(result.error, abortCause, resume, conversationId);
                }
            }
        }
        finally {
            callerSignal?.removeEventListener('abort', onCallerAbort);
        }
        // Terminal assembly. A started block is always closed, so the assembler
        // never holds an open text block when `finish` arrives.
        if (textOpen) {
            yield { type: 'block-end', index: 0, block: { type: 'text', text: textParts.join('') } };
        }
        if (failure === undefined && textParts.join('').trim().length === 0) {
            // A single pretty-printed JSON document has no parseable line, so the live
            // pass sees only unknown frames. Recover the answer from the whole capture
            // before the empty-answer branch turns a good document into a failure.
            const recovered = capture.trim().length === 0 ? undefined : recoverWholeSegment(capture);
            if (recovered !== undefined) {
                yield { type: 'block-start', index: 0, blockType: 'text' };
                yield { type: 'text-delta', index: 0, text: recovered };
                yield { type: 'block-end', index: 0, block: { type: 'text', text: recovered } };
                textParts.push(recovered);
            }
        }
        if (failure === undefined) {
            const empty = textParts.join('').trim().length === 0;
            if (empty) {
                // Never a silent success: an empty answer ends the turn with nothing for
                // the user or the loop to act on.
                failure = sawUnknownFrame
                    ? {
                        code: 'ZCODE_PARSE',
                        message: 'ZCode exited cleanly but its stdout carried no recognizable text frame; '
                            + `first bytes: ${parser.rawPreview.slice(0, 192)}`,
                    }
                    : { code: EMPTY_RESPONSE_CODE, message: 'ZCode completed without producing any output' };
            }
            else if (isToolStopReason(stopReason)) {
                // A stop reason naming a tool with no tool frame means the CLI ended the
                // turn for a reason this route cannot satisfy.
                failure = {
                    code: 'UNSUPPORTED_TOOLS',
                    message: `ZCode stopped with "${String(stopReason)}", which this route cannot project: `
                        + 'tool execution is not part of the v1 tool policy.',
                };
            }
        }
        this.logger({
            kind: failure === undefined ? 'zcode.request.completed' : 'zcode.request.failed',
            provider: this.provider,
            model: options.model,
            toolPolicy: this.toolPolicy,
            sessionMode: resume ? 'resume' : 'full',
            sharedSession: shared,
            conversationId,
            purpose: options.purpose,
            durationMs: Date.now() - startedAt,
            characters: textParts.join('').length,
            stopReason,
            abortCause,
            code: failure?.code,
            toolSchemas: options.tools?.length ?? 0,
            usage,
        });
        if (usage !== undefined)
            yield { type: 'usage', usage };
        yield {
            type: 'finish',
            reason: failure === undefined ? stopFinishReason(stopReason) : { kind: 'error', failure },
        };
    }
    // -------------------------------------------------------------------------
    // Failure mapping
    // -------------------------------------------------------------------------
    /**
     * Map one tool-shaped frame onto the fail-closed code that fits it.
     *
     * `permission` means the CLI needs an approval, `tool-call` means the model
     * asked for a tool this route never advertised. They need different fixes,
     * so they get different codes (registered deviation D-a).
     */
    toolFailure(frame) {
        const name = frame.toolName === undefined ? 'unknown tool' : `"${frame.toolName}"`;
        if (frame.request === 'permission') {
            return {
                code: 'PERMISSION_REQUIRED',
                message: `ZCode asked for approval to run ${name}. This provider runs headless with toolPolicy "${this.toolPolicy}", `
                    + 'so there is no approval channel and the process was stopped; approve the tool in the ZCode client, '
                    + 'or run the turn without tools.',
            };
        }
        return {
            code: 'UNSUPPORTED_TOOLS',
            message: `ZCode requested tool ${name}, but toolPolicy "${this.toolPolicy}" keeps DSH tool calls out of this route; `
                + 'the process was stopped instead of leaving the turn waiting for a result nobody can produce.',
        };
    }
    /**
     * Remember a provider-side quota rejection for the diagnostics surface.
     *
     * Recording only: the failure keeps travelling through {@link toLlmFailure}
     * into the terminal `finish` chunk exactly as before, and this cannot throw —
     * the diagnostics layer holds one module-level record. Without this call
     * `doctor`'s `last-quota` check could only ever say "nothing observed in this
     * process", even right after a real 1309.
     */
    noteQuotaObservation(error) {
        if (error.code !== 'QUOTA' || error.providerCode === undefined)
            return;
        const providerCode = String(error.providerCode);
        if (providerCode !== QUOTA_PROVIDER_CODE)
            return;
        recordQuotaObservation({ providerCode, requestId: error.requestId });
    }
    /**
     * Pre-spawn admission: refuse what this route cannot honor instead of letting
     * the CLI ignore it. Every branch here runs before `runZcode`, so a refused
     * request never spends a quota unit or leaves a process behind.
     */
    admissionFailure(options, prompt) {
        if (prompt.length > PROMPT_ARGV_MAX_CHARS) {
            return {
                code: 'ZCODE_UNKNOWN',
                message: `The rendered prompt is ${prompt.length} characters, above the ${PROMPT_ARGV_MAX_CHARS}-character ceiling `
                    + 'this route can pass on a Windows command line (32767 total). '
                    + 'The ZCode CLI accepts a one-shot prompt only as an argv entry, and this adapter will not truncate history.',
            };
        }
        const unsupported = unsupportedOptions(options);
        if (unsupported.length > 0) {
            return {
                code: 'UNSUPPORTED_OPTION',
                message: `ZCode 0.17.0's one-shot argv form has no place for ${unsupported.join(', ')}; `
                    + 'this adapter refuses the request instead of silently dropping the setting. '
                    + 'Remove these fields from the request.',
            };
        }
        const toolCount = options.tools?.length ?? 0;
        if (toolCount > 0 && this.toolPolicy !== 'zcode-owned') {
            // The CLI route has no way to hand a call back to DSH: zcode.cjs prints
            // tool progress as terminal text and exits, so the schemas go nowhere.
            // Refusing is the only honest answer.
            return this.toolPolicy === 'dsh-owned'
                ? {
                    code: 'UNSUPPORTED_TOOLS',
                    message: `toolPolicy "dsh-owned" is not implemented on this route: it cannot emit tool-call `
                        + `frames, so ${toolCount} declared tool(s) cannot be projected back to DSH. `
                        + 'Use "zcode-owned" (ZCode runs its own tools) or "reject" (no tools).',
                }
                : {
                    code: 'UNSUPPORTED_TOOLS',
                    message: `toolPolicy "reject" refuses ${toolCount} declared tool schema(s) before the process starts: `
                        + 'this route cannot project tool calls back to DSH. '
                        + 'Use "zcode-owned" (ZCode runs its own tools) or remove the tools from the request.',
                };
        }
        if (this.toolPolicy === 'reject') {
            const media = countMediaBlocks(options.messages);
            if (media > 0) {
                return {
                    code: 'UNSUPPORTED_CONTENT',
                    message: `toolPolicy "reject" refuses ${media} image/file block(s) before the process starts: `
                        + 'this route is text-only, and dropping the attachment silently would answer a different question. '
                        + 'Use "zcode-owned" or "dsh-owned" to receive placeholder text for attachments.',
                };
            }
        }
        return undefined;
    }
    /**
     * Ask the host for the session workspace root.
     *
     * A missing resolver, a missing session, a deleted directory or a throwing
     * registry all collapse to `undefined`; the caller fails closed with
     * `WORKSPACE_UNAVAILABLE` rather than guessing a directory.
     */
    async resolveCwd(conversationId) {
        if (conversationId === undefined || this.resolveWorkspaceRoot === undefined)
            return undefined;
        try {
            const root = await this.resolveWorkspaceRoot(conversationId);
            const trimmed = root?.trim();
            return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
        }
        catch (error) {
            this.logger({
                kind: 'zcode.workspace.resolve.failed',
                conversationId,
                message: error instanceof Error ? error.message : String(error),
            });
            return undefined;
        }
    }
    /** Map a process-layer failure, keeping a caller cancellation distinguishable. */
    processFailure(error, abortCause, resume, conversationId) {
        if (isZcodeError(error))
            this.noteQuotaObservation(error);
        const failure = isZcodeError(error) ? toLlmFailure(error) : {
            code: 'ZCODE_UNKNOWN',
            message: error instanceof Error ? error.message : String(error),
        };
        if (abortCause === 'caller') {
            return { code: 'ABORTED', message: 'The ZCode request was cancelled by the caller' };
        }
        this.forgetStaleSession(failure, resume, conversationId);
        return failure;
    }
    /**
     * Drop the remembered session id after a failure that means the id is dead.
     *
     * A dead id fails identically on the next attempt, and retrying it in full
     * mode would spend another quota unit on a guess (registered deviation D-b).
     * Dropping the record lets the next turn start clean — logging alone left
     * resume mode reusing the dead id forever. Shared by both routes: the
     * app-server channel fails its `session/resume` with the same codes.
     */
    forgetStaleSession(failure, resume, conversationId) {
        if (!resume || conversationId === undefined || !DROPS_SESSION_ON.has(failure.code))
            return;
        this.logger({ kind: 'zcode.session.stale', code: failure.code, conversationId });
        try {
            this.sessions.delete(conversationId);
        }
        catch (forgetError) {
            this.logger({
                kind: 'zcode.session.forget.failed',
                conversationId,
                message: forgetError instanceof Error ? forgetError.message : String(forgetError),
            });
        }
    }
    // -------------------------------------------------------------------------
    // Session bookkeeping
    // -------------------------------------------------------------------------
    remember(conversationId, sessionId) {
        try {
            this.sessions.set(conversationId, sessionId);
        }
        catch (error) {
            // A failed write must not fail the turn: the answer is already in hand.
            this.logger({
                kind: 'zcode.session.persist.failed',
                conversationId,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    // -------------------------------------------------------------------------
    // Catalog helpers
    // -------------------------------------------------------------------------
    modelInfo(provider, entry) {
        return {
            provider,
            id: entry.id,
            name: entry.name ?? entry.id,
            ...(entry.description === undefined ? {} : { description: entry.description }),
            inputModalities: this.imageInputMode() ? IMAGE_AND_TEXT : TEXT_ONLY,
        };
    }
    /**
     * 图片输入能力(2026-11-18):free 路由走 app-server 的 session/send attachments
     * (CLI 协议原生支持 {type:'image', path|data-URI},桌面端拖图就是这条路);
     * config.imageInput='experimental' 强制开启。原先硬编码 TEXT_ONLY,
     * 导致 DSH 对任何图片请求直接拒收("当前模型不支持图片")。
     */
    imageInputMode() {
        if (this.config?.imageInput === 'experimental')
            return true;
        return nonEmpty(this.getSelection?.()?.plan) !== 'paid';
    }
    /**
     * Filter the configured retry allowlist down to the codes this route can
     * actually produce, falling back to the defaults when nothing survives.
     */
    retryableCodes() {
        const allowed = new Set(ZCODE_RETRYABLE_CODES);
        const configured = (this.config.retryPolicy?.retryableCodes ?? [...ZCODE_RETRYABLE_CODES])
            .filter(code => allowed.has(code));
        return configured.length > 0 ? configured : [...ZCODE_RETRYABLE_CODES];
    }
    // -------------------------------------------------------------------------
    // Prompt projection
    // -------------------------------------------------------------------------
    /**
     * Render the request as the single prompt string the CLI accepts.
     *
     * `resume` narrows the scope to the messages produced after this route's own
     * last assistant message: the resumed ZCode session already holds everything
     * up to and including that answer, so resending it would duplicate the whole
     * conversation inside the model's context.
     */
    buildPrompt(options, resume, imageSink) {
        const messages = resume ? this.turnAfterOwnAssistant(options.messages) : options.messages;
        const sections = [];
        // DSH 系统提示默认不进 CLI prompt(2026-11-18):CLI 是自带完整系统提示的
        // agent,DSH 预设的 system(含其拉进来的全局指令/工具清单,单轮可达 ~95k
        // token)对远端模型是纯噪音,还会被它当成"注入内容"分析甚至拒绝。
        // 全局指令改走受信任通道(isolatedHome 种入 CLI 原生 AGENTS.md 路径)。
        // forwardSystemPrompt: true 可恢复旧行为。
        const forwardSystem = configFlag(this.config.forwardSystemPrompt, false);
        if (forwardSystem
            && options.system !== undefined && options.system.trim().length > 0) {
            sections.push(`# 系统提示\n${options.system}`);
        }
        if (messages !== options.messages) {
            sections.push('# 会话历史已由 ZCode 会话保存，下面仅是本轮新增内容');
        }
        for (const message of messages) {
            // forwardSystemPrompt=false 时历史 system/developer 消息一并跳过:
            // DSH 每轮开始会把完整系统提示重发成历史 system 消息(seq 靠尾部),
            // resume 切片后恰好落在"上一条助手消息之后",不从历史掐掉就会漏进
            // CLI prompt——这是粘贴通道的最后一条泄漏路径。
            if (!forwardSystem && (message.role === 'system' || message.role === 'developer'))
                continue;
            const body = renderContent(message.content, imageSink).trim();
            if (body.length === 0)
                continue;
            sections.push(`${roleHeading(message)}:\n${body}`);
        }
        return sections.join('\n\n');
    }
    /** Messages after this route's last assistant answer; the whole list when there is none. */
    turnAfterOwnAssistant(messages) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (message === undefined || message.role !== 'assistant')
                continue;
            if (message.source.kind !== 'model')
                continue;
            if (message.source.provider !== this.provider)
                continue;
            return messages.slice(index + 1);
        }
        return messages;
    }
}
// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/**
 * Codes that mean the remembered session id is unusable.
 *
 * `QUOTA`, `RATE_LIMIT`, `AUTH`, `TIMEOUT` and `ABORTED` all describe the
 * account or the transport, so the id stays: dropping it would throw away a
 * still-valid session because of a transient condition.
 *
 * `ZCODE_PARSE` is deliberately absent. It is produced only by the clean-exit
 * branch that saw no recognizable text frame, and the process layer never
 * raises it, so `processFailure` cannot observe it at all. A clean exit leaves
 * the server-side session intact — the gap is in this parser, which has never
 * seen a successful stdout (finding F-1) — so forgetting the id there would
 * destroy a session nothing proves broken.
 */
const DROPS_SESSION_ON = new Set(['ZCODE_EXIT', 'ZCODE_UNKNOWN']);
/**
 * Request fields this route has no place for, rendered for the failure
 * message. `stop: []` is a no-op and therefore accepted.
 */
function unsupportedOptions(options) {
    const found = [];
    if (options.temperature !== undefined)
        found.push(`temperature=${String(options.temperature)}`);
    if (options.maxTokens !== undefined)
        found.push(`maxTokens=${String(options.maxTokens)}`);
    if (options.stop !== undefined && options.stop.length > 0)
        found.push(`stop=${JSON.stringify(options.stop)}`);
    return found;
}
/** Number of image/file blocks anywhere in the request history. */
function countMediaBlocks(messages) {
    let count = 0;
    for (const message of messages) {
        for (const block of message.content) {
            if (block.type === 'image' || block.type === 'file')
                count += 1;
        }
    }
    return count;
}
/** Heading of one transcript message. The CLI sees plain text, so roles must be labeled. */
function roleHeading(message) {
    switch (message.role) {
        case 'system': return '# 系统提示';
        case 'developer': return '# 系统更新';
        case 'user': return '## 用户';
        case 'assistant': return '## 助手';
        case 'tool': {
            const outcome = message.isError === true ? '，失败' : '';
            return `## 工具结果（调用 ${String(message.toolCallId)}${outcome}）`;
        }
        default: return '## 消息';
    }
}
/**
 * Flatten one content array into transcript text.
 *
 * Every block projects to text because this route is text-only: an image
 * becomes a placeholder naming its dimensions and byte size (registered
 * deviation D-c), and reasoning is wrapped in tags so a later turn can tell it
 * apart from the answer itself.
 */
function renderContent(content, sink) {
    const parts = [];
    for (const block of content) {
        switch (block.type) {
            case 'text': {
                parts.push(block.text);
                break;
            }
            case 'reasoning': {
                parts.push(`<thinking>${block.text}</thinking>`);
                break;
            }
            case 'tool-call': {
                parts.push(`[工具调用 ${block.name}] ${block.arguments}`);
                break;
            }
            case 'image': {
                // 2026-11-18:图片通道打开时,能解析出宿主路径的图片作为真实附件随
                // session/send 携带(sink.imagePaths),文本里不再留占位;解析不出的
                // 仍走占位文本,保证模型知道用户发了图但通道没带上。
                //
                // 2026-11-18 二次修复:CLI 附件归一化器 N4c 读的是 kind/filename/
                // mimeType/localPath(CLI 原生形状,{type,path} 会被静默丢弃,模型
                // 只看到占位文本)。宿主对象是 DSH 归一化图片(objects/ 树,无扩展
                // 名),mimeType 用块里带的值,image/png 兜底。
                const hostPath = sink?.imagePaths !== undefined ? sink.imagePathOf?.(block.attachment) : undefined;
                if (typeof hostPath === 'string' && hostPath.length > 0) {
                    sink.imagePaths.push({
                        kind: 'image',
                        filename: 'image.png',
                        mimeType: typeof block.attachment.mimeType === 'string' && block.attachment.mimeType.length > 0
                            ? block.attachment.mimeType
                            : 'image/png',
                        localPath: hostPath,
                    });
                    break;
                }
                const name = block.attachment.name ?? String(block.attachment.attachmentId);
                const size = `${block.attachment.width}×${block.attachment.height}, ${block.attachment.bytes} bytes`;
                parts.push(`[图片附件 ${name} (${size})：本路由为纯文本，图片内容未发送]`);
                break;
            }
            case 'file': {
                parts.push(`[文件附件 ${block.attachment.name} (${block.attachment.bytes} bytes)：本路由为纯文本，文件内容未发送]`);
                break;
            }
            case 'tool-addition': {
                parts.push(`[工具可用: ${block.toolName}]`);
                break;
            }
            case 'tool-removal': {
                parts.push(`[工具移除: ${block.toolName}]`);
                break;
            }
            default: {
                break;
            }
        }
    }
    return parts.join('\n');
}
/** Project one parsed usage frame onto the disjoint DSH counters. */
function toTokenUsage(usage) {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
        ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
        ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
        ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
    };
}
/**
 * Map a provider error onto the DSH failure shape.
 *
 * DSH's `LlmFailure` has no field for a provider code or a request id (and its
 * request id is branded, so it cannot be constructed here), yet those two are
 * exactly what makes a ZCode failure actionable. They are therefore folded into
 * the message, which every consumer renders.
 */
function toLlmFailure(error) {
    const details = [];
    if (error.providerCode !== undefined)
        details.push(`providerCode=${error.providerCode}`);
    if (error.providerMessage !== undefined)
        details.push(`providerMessage=${error.providerMessage}`);
    if (error.responseStatus !== undefined)
        details.push(`responseStatus=${error.responseStatus}`);
    if (error.requestId !== undefined)
        details.push(`request-id=${error.requestId}`);
    if (error.stderrTail !== undefined)
        details.push(`stderr=${error.stderrTail}`);
    const rendered = details.length === 0 ? error.message : `${error.message} (${details.join('; ')})`;
    return {
        code: error.code,
        // Third-party text reaches logs and the transcript: redact credentials and
        // cap the total, or one upstream dump can flood both.
        message: boundDiagnostic(rendered),
        ...(error.responseStatus === undefined ? {} : { status: error.responseStatus }),
    };
}
/** Success-side finish reason; a length stop is the only provider reason with a DSH equivalent. */
function stopFinishReason(stopReason) {
    const normalized = (stopReason ?? '').toLowerCase();
    if (normalized.includes('length') || normalized.includes('max_token') || normalized.includes('max-token')) {
        return { kind: 'max-tokens' };
    }
    return { kind: 'stop' };
}
/** Whether a provider stop reason names a tool, i.e. a turn this route cannot complete. */
function isToolStopReason(stopReason) {
    return (stopReason ?? '').toLowerCase().includes('tool');
}
/** Trimmed value, or `undefined` for a blank one. */
function nonEmpty(value) {
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}
/**
 * Field diagnostics tee: when `ZCODE_DEBUG_LOG` names a file, every logger
 * record is also appended there (one JSON line each). Exists because the host
 * console is invisible in the field — a Pocket-side "发送失败" cannot be
 * diagnosed without a durable record of the adapter's own view of the turn.
 * Always-on cost when unset: one `process.env` read per construction.
 */
function debugTee(logger) {
    const target = process.env.ZCODE_DEBUG_LOG;
    if (target === undefined || target.trim().length === 0)
        return logger;
    const path = target.trim();
    return (record) => {
        try {
            appendFileSync(path, `${JSON.stringify({ t: new Date().toISOString(), record })}\n`, { flag: 'a' });
        }
        catch {
            // Diagnostics must never break a turn: a failed append is swallowed.
        }
        logger(record);
    };
}
/** Re-export so consumers of this module need one import for the error type. */
export { ZcodeError, isZcodeError };
// ---------------------------------------------------------------------------
// Free-plan wiring helpers
// ---------------------------------------------------------------------------
/**
 * The data root the app-server child must share with the CLI's own state:
 * `ZCODE_DATA_BASE_DIR`, resolved against the same contract the spawn layer
 * enforces. Empty means the host never supplied the variable, which the
 * credential reader will surface as `ZCODE_CREDENTIAL_MISSING` at request
 * time — an honest late failure beats guessing a path.
 */
function zcodeDataBaseDir() {
    return nonEmpty(process.env['ZCODE_DATA_BASE_DIR']) ?? nonEmpty(process.env['ZCODE_DATA_BASE_DIR'.toLowerCase()]) ?? '';
}
/**
 * The built-in provider table the account injection is built from. This must
 * be the canonical resource path — the runtime-cached copy under
 * `runtime/provider/…` silently no-ops the injection (probe evidence
 * 2026-10-25), and the spawn contract already pins the resource location.
 */
function zcodeBuiltinPath() {
    return nonEmpty(process.env['ZCODE_BUILTIN_PROVIDER_CONFIG_FILE'])
        ?? 'F:\\AgentData\\zcode\\cli\\resources\\config\\provider\\zcode-builtin.json';
}
/**
 * Environment for the app-server child: the same closed shape the `-p` route
 * builds — OS variables from the allowlist, the four contract values, the
 * operator's `passEnv` names, and a `NODE_OPTIONS` that always carries the DNS
 * transport fix. The injected account table must point at the canonical builtin
 * path (not the runtime cache) for the injection to reach the provider
 * registry, hence the explicit `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` pass-through.
 */
function freePlanEnv(passEnv, isolatedHome = true) {
    const env = {};
    for (const key of ZCODE_ENV_ALLOWLIST) {
        const value = process.env[key];
        if (value !== undefined && value.length > 0)
            env[key] = value;
    }
    for (const key of passEnv) {
        if (!ENV_NAME_PATTERN.test(key))
            continue;
        const value = process.env[key];
        if (value !== undefined && value.length > 0)
            env[key] = value;
    }
    const pick = (name) => {
        const value = nonEmpty(process.env[name]);
        if (value !== undefined)
            env[name] = value;
    };
    pick('ZCODE_HOME');
    pick('ZCODE_DATA_BASE_DIR');
    pick('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE');
    pick('ZCODE_BUILTIN_PROVIDER_CONFIG_FILE');
    // 隔离并种入 CLI 的"用户全局指令"(2026-11-18):CLI 上下文组装用 HOME(或
    // USERPROFILE)拼 `$HOME/.zcode/AGENTS.md`。这里给子进程一个专用 HOME,
    // 并把宿主的全局指令复制到同一路径——CLI 把它当作自己的真实用户指令
    // 加载(受信任通道,与其自身配置同级),远端模型不再把它当"粘贴进消息
    // 的注入文本"分析/拒绝。shell rc(zsh/bash)查找落空;os.homedir() 在
    // Windows 走 USERPROFILE,凭据/数据路径(ZCODE_HOME、ZCODE_DATA_BASE_DIR)
    // 都不经 HOME(H3s 全 CLI 只有 AGENTS.md 一个消费者,已核实)。
    if (isolatedHome) {
        try {
            const fakeHome = join(homedir(), '.zcode-bridge', 'cli-home');
            const seedDir = join(fakeHome, '.zcode');
            mkdirSync(seedDir, { recursive: true });
            try {
                const source = readFileSync(join(homedir(), '.zcode', 'AGENTS.md'), 'utf8');
                const seeded = join(seedDir, 'AGENTS.md');
                let current;
                try {
                    current = readFileSync(seeded, 'utf8');
                }
                catch {
                    /* 首次种入 */
                }
                if (current !== source)
                    writeFileSync(seeded, source, 'utf8');
            }
            catch {
                /* 宿主没有全局指令:保持空,无注入也无种入 */
            }
            env['HOME'] = fakeHome;
        }
        catch {
            // 建不出来就保持继承的真实 HOME:指令照旧走原生通道,轮次不受影响。
        }
    }
    // The app-server child reaches the same API over HTTP as the `-p` child, so
    // it gets the same ipv4-first fix. A host value carrying an unknown flag is
    // dropped rather than inherited (an unknown flag can smuggle a `--require`)
    // and never refused: this route degrades instead of failing the turn.
    let nodeOptions;
    try {
        nodeOptions = resolveNodeOptions(process.env['NODE_OPTIONS']);
    }
    catch {
        nodeOptions = NODE_OPTIONS_REQUIRED.join(' ');
    }
    env['NODE_OPTIONS'] = nodeOptions;
    return env;
}
/** The card's effort pick, narrowed to a known upstream id. */
function effortId(value) {
    return typeof value === 'string' && ZCODE_EFFORT_IDS.includes(value) ? value : undefined;
}
//# sourceMappingURL=zcode.js.map