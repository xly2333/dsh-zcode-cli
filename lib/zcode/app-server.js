/**
 * The ZCode app-server channel (`zcode.cjs app-server --stdio`).
 *
 * One child process speaks a line-delimited JSON protocol with no `jsonrpc`
 * field (a line carrying `jsonrpc:"2.0"` is rejected with -32600):
 *
 * - `{id, result|error}` — a response to one of our requests;
 * - `{id, method, params}` — a CLI→host callback that MUST be answered with
 *   `{id, result}`, or the turn fails;
 * - everything else — an event.
 *
 * A turn is: spawn → wait-ready by polling `provider/refreshRegistry` (never
 * by watching stdout) → `provider/updateAccountConfig` → `refreshRegistry` →
 * `session/create` (or `session/resume`) → `session/subscribe` →
 * `session/send` → collect frames until the terminal event → tear down.
 *
 * Credential red line: the plan token flows only through the
 * `interaction/requestProviderRuntimeHeaders` answer. It is never logged,
 * never placed into an error, never returned in a frame.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ZcodeError } from '../provider/error-codes.js';
import { ZcodeCredentialError } from './credential.js';
import { terminateProcessTree } from './process.js';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const WIRE_LOG_PATH = join(homedir(), '.zcode-bridge', 'appserver-wire.log');
// 256MB: with a long DSH conversation the app-server replays sizable
// `session/updated` / telemetry envelopes every turn; the 8MB process-era cap
// killed real turns (2026-10-25 field report "output exceeded 8388608 bytes").
// This valve only exists against a runaway child, not as a turn budget.
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const READY_POLL_INTERVAL_MS = 250;
const READY_POLL_ATTEMPTS = 60;
const READY_POLL_TIMEOUT_MS = 800;
const KILL_GRACE_MS = 3_000;
function fail(code, message, cause) {
    return new ZcodeError(code, message, cause === undefined ? {} : { cause });
}
function errorText(cause) {
    return cause instanceof Error ? cause.message : String(cause);
}
function truncate(text, max) {
    return text.length <= max ? text : `…${text.slice(text.length - (max - 1))}`;
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.length > 0)
            return value;
    }
    return undefined;
}
/**
 * One managed app-server process. All protocol traffic lives here; both the
 * turn runner and the settings probe drive it through the small public surface.
 */
class AppServerSession {
    child;
    pending = new Map();
    frames = [];
    maxOutputBytes;
    timeoutMs;
    idleTimeoutMs;
    signal;
    deps;
    sessionId;
    thoughtLevels = [];
    available = [];
    terminal;
    /** 在途轮次标记:缓存命中时要求 false,双保险防并发轮次打进同一进程。 */
    busy = false;
    nextId = 1;
    stdoutBuffer = '';
    outputBytes = 0;
    stderrTail = '';
    killed = false;
    failure;
    idleTimer;
    onAbort = () => {
        this.setFailure(fail('ABORTED', 'ZCode app-server request aborted'));
    };
    /** 进程复用:换绑新 turn 的取消信号(旧 turn 的 signal 已结束)。 */
    rebindSignal(signal) {
        try {
            this.signal?.removeEventListener('abort', this.onAbort);
        }
        catch {
            /* ignore */
        }
        this.signal = signal;
        this.failure = undefined;
        signal?.addEventListener('abort', this.onAbort, { once: true });
    }
    constructor(deps, signal) {
        this.deps = deps;
        this.signal = signal;
        this.maxOutputBytes = deps.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        const spawnFn = deps.spawn ?? nodeSpawn;
        try {
            // --surface desktop：headless 会话挂到桌面端（官方管道），模型选择与
            // enc:v2 凭据解密桥都走桌面 —— 否则 -p/app-server 没有模型来源
            //（"Select a model before sending a message"）且凭据解不开。
            this.child = spawnFn(deps.nodePath, [deps.zcodeCjsPath, 'app-server', '--stdio', '--surface', 'desktop'], {
                env: { ...deps.env },
                shell: false,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        catch (cause) {
            throw fail('ZCODE_EXIT', `Unable to spawn ZCode app-server: ${errorText(cause)}`, cause);
        }
        signal?.addEventListener('abort', this.onAbort, { once: true });
        // 子进程退出监听(2026-11-17):CLI app-server 空闲自退/意外退出时,
        // 没有这个监听的话缓存的 session 会假装活着,下一轮复用直接挂死
        // (复用检查只看 killed/failure,看不到进程已死)。
        this.childExited = false;
        this.child.on('exit', (code) => {
            this.childExited = true;
            this.setFailure(fail('ZCODE_EXIT', `ZCode app-server exited (code ${code ?? 'null'})`));
        });
        // The offline tests inject a fake child whose streams are plain strings, so
        // `setEncoding` is called defensively: a real ChildProcess has it, the fake
        // does not, and the data handler accepts both strings and Buffers.
        if (typeof this.child.stdout?.setEncoding === 'function') {
            this.child.stdout?.setEncoding('utf8');
        }
        this.child.stdout?.on('data', (chunk) => { this.onStdout(typeof chunk === 'string' ? chunk : String(chunk)); });
        if (typeof this.child.stderr?.setEncoding === 'function') {
            this.child.stderr?.setEncoding('utf8');
        }
        this.child.stderr?.on('data', (chunk) => {
            this.stderrTail = (this.stderrTail + (typeof chunk === 'string' ? chunk : String(chunk))).slice(-2_048);
        });
        this.child.once('error', (cause) => {
            this.setFailure(fail('ZCODE_EXIT', `ZCode app-server failed to start: ${errorText(cause)}`, cause));
        });
        this.child.once('exit', (code, signalName) => {
            if (this.failure !== undefined)
                return;
            const detail = stderrTailOf(this.stderrTail);
            this.setFailure(fail('ZCODE_EXIT', `ZCode app-server exited unexpectedly (code ${code === null ? 'unknown' : String(code)}${signalName === null ? '' : `, signal ${signalName}`})${detail}`));
        });
        this.armIdle();
    }
    onStdout(chunk) {
        if (this.failure !== undefined)
            return;
        this.outputBytes += Buffer.byteLength(chunk);
        if (this.outputBytes > this.maxOutputBytes) {
            this.setFailure(fail('ZCODE_UNKNOWN', `ZCode app-server output exceeded ${this.maxOutputBytes} bytes`));
            return;
        }
        this.stdoutBuffer += chunk;
        let newline;
        while ((newline = this.stdoutBuffer.indexOf('\n')) >= 0) {
            const line = this.stdoutBuffer.slice(0, newline).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
            if (line.length === 0)
                continue;
            let message;
            try {
                message = JSON.parse(line);
            }
            catch {
                this.setFailure(fail('ZCODE_PARSE', 'ZCode app-server stdout line is not JSON'));
                return;
            }
            this.wireLog('CLI line', message);
            this.armIdle();
            if (message.id !== undefined && message.method === undefined) {
                this.settlePending(message);
            }
            else if (message.id !== undefined && typeof message.method === 'string') {
                this.answerCallback(message);
            }
            else {
                this.handleEvent(line, message);
            }
        }
    }
    settlePending(message) {
        if (typeof message.id !== 'number')
            return;
        const entry = this.pending.get(message.id);
        if (entry === undefined)
            return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error !== undefined) {
            const code = typeof message.error.code === 'number' ? message.error.code : undefined;
            const text = typeof message.error.message === 'string' ? message.error.message : 'unknown error';
            entry.reject(fail('ZCODE_UNKNOWN', `ZCode app-server rejected ${entry.method} (${code ?? 'error'}): ${truncate(text, 300)}`));
        }
        else {
            entry.resolve(message);
        }
    }
    sendLine(message) {
        const stdin = this.child.stdin;
        if (stdin === null || stdin.destroyed || this.killed)
            return false;
        try {
            stdin.write(`${JSON.stringify(message)}\n`);
            return true;
        }
        catch {
            return false;
        }
    }
    request(method, params, timeoutMs = this.timeoutMs) {
        if (this.failure !== undefined)
            return Promise.reject(this.failure);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(fail('TIMEOUT', `ZCode app-server request timed out: ${method}`));
            }, timeoutMs);
            timer.unref?.();
            this.pending.set(id, { method, resolve, reject, timer });
            if (!this.sendLine({ id, method, params })) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(this.failure ?? fail('ZCODE_EXIT', 'ZCode app-server stdin is closed'));
            }
        });
    }
    answerCallback(message) {
        this.wireLog('CLI->HOST callback', message);
        const method = message.method ?? '';
        const id = message.id;
        if (method === 'interaction/requestProviderRuntimeHeaders') {
            // The only place the plan token leaves the credential module. The answer
            // is the `headersApplied:true` branch of the CLI's strict schema.
            let apiKey;
            try {
                apiKey = this.deps.planToken();
            }
            catch (cause) {
                // 2026-11-17：planToken 解不出来（如 ZCode 3.18 的 enc:v2 凭据，旧
                // enc:v1 解密器不认识）不再杀轮次。免费路线的 start-plan 请求签名
                // 本来就由 CLI 用自己的凭据完成，这里只答 headersApplied:false
                // 走 CLI 的优雅降级分支，让轮次继续。
                this.log({
                    kind: 'zcode.appserver.plantoken-unavailable',
                    record: cause instanceof Error ? (cause.code ?? cause.message) : String(cause),
                });
                this.sendLine({ id, result: { headersApplied: false, errorMessage: 'plan token unavailable' } });
                return;
            }
            if (!this.sendLine({
                id,
                result: {
                    headersApplied: true,
                    requestAuth: {
                        apiKey,
                        headers: { 'http-referer': 'https://zcode.z.ai', 'x-title': 'Z Code@cli' },
                    },
                },
            })) {
                this.setFailure(fail('ZCODE_EXIT', 'cannot answer requestProviderRuntimeHeaders: stdin closed'));
            }
            return;
        }
        if (method === 'session/requestRuntimePreferences') {
            this.sendLine({
                id,
                result: {
                    nativeSearchEnhancementsEnabled: false,
                    memoryEnabled: false,
                    askUserQuestionAutoResolutionEnabled: true,
                    modelContextBudgetStrategy: 'preflight-v1',
                },
            });
            return;
        }
        if (method === 'interaction/requestPermission') {
            const params = (message.params ?? {});
            const toolName = typeof params.toolName === 'string' ? params.toolName : '<unknown tool>';
            if (this.deps.permissionMode === 'yolo') {
                // yolo(2026-11-18 "开工具"):放行 CLI 原生工具,工具在 CLI 子进程
                // 内以宿主用户权限执行。决策语义沿用 CLI permission response
                // schema(MF:decision ∈ allow|deny|escalate|modify,strict,
                // 多余字段被拒),所以只发 decision 一个键。
                this.log({ kind: 'zcode.appserver.permission.allowed', toolName, requestId: params.requestId });
                this.sendLine({ id, result: { decision: 'allow' } });
                return;
            }
            // Fail closed, deliberately.
            //
            // The CLI asks its client to approve a tool call. This provider runs
            // headless and has no approval channel to offer, so the only safe answer
            // is "no": approving here would execute a tool the user never saw, which
            // is exactly the fail-open hole the `-p` path used to close by killing
            // the process.
            //
            // Response shape is the CLI's own `permission response` schema (`MF` in
            // `zcode.cjs`): a strict object with `decision` drawn from
            // allow|deny|escalate|modify and an optional `reason`. Extra fields are
            // rejected, so nothing else is sent.
            this.log({ kind: 'zcode.appserver.permission.denied', toolName, requestId: params.requestId });
            this.sendLine({
                id,
                result: {
                    decision: 'deny',
                    reason: `DSH has no approval channel for ZCode tool calls, so "${toolName}" was denied. `
                        + 'Route tools through the DSH MCP bridge instead of letting the CLI run them.',
                },
            });
            return;
        }
        this.log({ kind: 'zcode.appserver.callback.unhandled', method });
        // Unknown callbacks get a minimal ack so the turn is not blocked on them.
        // Known gap: `interaction/requestUserInput` also lands here, and an empty
        // ack may leave the CLI waiting. Its response schema was not copied, and
        // inventing one is worse than acking — see `docs/zcode-a3-tool-bridge.md`.
        this.sendLine({ id, result: {} });
    }
    handleEvent(line, message) {
        this.wireLog('CLI->HOST event', message);
        const params = (message.params ?? {});
        const payload = (params.payload ?? {});
        const method = typeof message.method === 'string' ? message.method : undefined;
        // The live wire carries the part kind EITHER at `params.kind` (telemetry
        // envelope: v4/telemetry/event …) or at `params.payload.kind` (session/event
        // streaming). Read both.
        const paramsKind = params.kind;
        let kind = typeof paramsKind === 'string' && paramsKind.length > 0 ? paramsKind : payload.kind;
        // `v4/telemetry/event` names the event in `params.type`, not `kind`
        // (live capture 2026-10-25: kind/status sit at the params top level there).
        if ((kind === undefined || kind === null) && typeof params.type === 'string' && params.type.startsWith('turn.')) {
            kind = params.type;
        }
        // Terminal: the CLI emits a turn.terminal event whose kind/status sit at the
        // envelope top level (v4/telemetry/event) or inside `payload` (session/event
        // alternates: turn.completed / turn.failed). Both spellings are matched on
        // both carriers: `kind` may come from `params.kind` (envelope) or
        // `payload.kind` (session/event), and `params.type` from either.
        //
        // ZCode 3.18 两种新终端形状(2026-11-17 wire 实录,旧匹配全漏):
        //  a) `computer-use/operation-event` 携带 params.kind = "turn-completed"(连字符)
        //  b) `session/event` 携带 payload.stopReason("stop"=成功)+ payload.content/response
        const isTerminal = kind === 'turn.terminal' || kind === 'turn.completed' || kind === 'turn.failed' || kind === 'turn-completed'
            || params.type === 'turn.terminal' || params.type === 'turn.completed' || params.type === 'turn.failed'
            || params.type === 'turn-completed';
        const v3StopReason = method === 'session/event' && payload !== null && typeof payload === 'object'
            && payload.stopReason !== undefined && payload.delta === undefined
            ? String(payload.stopReason)
            : undefined;
        // ZCode 3.18 stopReason 语义(CLI 映射函数实录 2026-11-18):上游
        // "tool_use"→"tool-calls"、"compaction"→"other" 都是单个模型请求的
        // 收尾,轮次随后继续(工具执行/压缩后模型接着说,同 turn 会有多个
        // requestId 的 usage.delta)。只有 "stop" 是成功终端;失败终端见
        // V3_TERMINAL_FAILURE_STOP_REASONS。此前把一切非 stop 都当终端,
        // 模型一调工具整轮就被误杀("turn stop reason: tool-calls")。
        if (v3StopReason !== undefined && v3StopReason !== 'stop'
            && !V3_TERMINAL_FAILURE_STOP_REASONS.has(v3StopReason)) {
            // 中间态(tool-calls/other/未知):正文已由流式 delta 投影,这里只记录。
            this.log({ kind: 'zcode.appserver.v3-intermediate', stopReason: v3StopReason });
            return;
        }
        if (isTerminal || v3StopReason !== undefined) {
            // v3 stopReason 形状:stop=成功,其余按失败处理;正文在 payload.content。
            const rawStatus = v3StopReason !== undefined
                ? (v3StopReason === 'stop' ? 'success' : 'failed')
                : firstString(payload.status, params.status, payload.resultType);
            const status = rawStatus === 'success' ? 'success' : 'failed';
            const payloadError = payload.error;
            const errorCode = firstString(payload.errorCode, params.errorCode, payloadError?.code, payloadError?.type)
                ?? (v3StopReason !== undefined && v3StopReason !== 'stop' ? `V3_STOP_${v3StopReason.toUpperCase()}` : undefined);
            const errorMessage = firstString(payload.errorMessage, params.errorMessage, payloadError?.message)
                ?? (v3StopReason !== undefined && v3StopReason !== 'stop' ? `ZCode 3.18 turn stop reason: ${v3StopReason}` : undefined);
            // 终端正文:优先 payload.content(3.18 stopReason 形状),其次 payload.response(旧形状)。
            const responseText = typeof payload.content === 'string' && payload.content.length > 0
                ? payload.content
                : (typeof payload.response === 'string' && payload.response.length > 0
                    ? payload.response
                    : undefined);
            this.terminal = {
                status,
                ...(errorCode === undefined ? {} : { errorCode }),
                ...(errorMessage === undefined ? {} : { errorMessage }),
                ...(responseText === undefined ? {} : { responseText }),
            };
            // The session/event terminal carries the provider usage in its payload
            // (live capture: `{usage:{inputTokens,outputTokens,totalTokens,…}}`); the
            // telemetry envelope carries only a token total. Prefer the detailed one.
            const u = payload.usage;
            if (u !== null && typeof u === 'object') {
                const rec = u;
                const inputTokens = typeof rec['inputTokens'] === 'number' ? rec['inputTokens'] : 0;
                const outputTokens = typeof rec['outputTokens'] === 'number' ? rec['outputTokens'] : 0;
                const totalTokens = typeof rec['totalTokens'] === 'number' ? rec['totalTokens'] : undefined;
                const cacheReadTokens = typeof rec['cacheReadTokens'] === 'number' ? rec['cacheReadTokens'] : undefined;
                const cacheWriteTokens = typeof rec['cacheWriteTokens'] === 'number' ? rec['cacheWriteTokens'] : undefined;
                if (inputTokens > 0 || outputTokens > 0) {
                    this.frames.push({
                        kind: 'usage',
                        usage: {
                            inputTokens,
                            outputTokens,
                            ...(totalTokens === undefined ? {} : { totalTokens }),
                            ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
                            ...(cacheWriteTokens === undefined ? {} : { cacheCreationTokens: cacheWriteTokens }),
                        },
                    });
                }
                else {
                    const tokenCount = typeof payload.tokenCount === 'number' ? payload.tokenCount
                        : typeof params.tokenCount === 'number'
                            ? params.tokenCount
                            : undefined;
                    if (tokenCount !== undefined && tokenCount > 0) {
                        this.frames.push({ kind: 'usage', usage: { inputTokens: 0, outputTokens: tokenCount, totalTokens: tokenCount } });
                    }
                }
            }
            return;
        }
        if (kind === 'turn.started' || params.type === 'turn.started')
            return;
        if (kind === 'model.streaming' || params.type === 'model.streaming') {
            const delta = firstString(payload.delta, params.delta);
            if (typeof delta === 'string' && delta.length > 0) {
                // `kind` here is the part kind (text_delta / reasoning_delta / tool_input_* …).
                const partKind = kind === 'model.streaming' || kind === undefined ? readPartKind(payload) : kind;
                if (partKind === 'reasoning_delta') {
                    const frame = { kind: 'thinking', text: delta };
                    this.frames.push(frame);
                    // 流式投影:思考增量实时回调(宿主可据此在界面上先显示思考)
                    this.deps.onFrame?.(frame);
                }
                else {
                    const frame = { kind: 'text', text: delta };
                    this.frames.push(frame);
                    this.deps.onFrame?.(frame);
                }
            }
            return;
        }
        // Everything else (session.updated, titleUpdated, tool.updated, …) does not
        // project into frames.
    }
    /** 协议流抓包(2026-11-17 诊断挂死):每行/回调落到 wire.log,排障完可移除。 */
    wireLog(tag, message) {
        try {
            const line = typeof message === 'string' ? message : JSON.stringify(message);
            appendFileSync(WIRE_LOG_PATH, `${new Date().toISOString()} [${tag}] ${line.slice(0, 1500)}\n`, 'utf8');
        }
        catch {
            /* 抓包失败不影响主流程 */
        }
    }
    armIdle() {
        if (this.idleTimer !== undefined)
            clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.setFailure(fail('TIMEOUT', `ZCode app-server idle for ${this.idleTimeoutMs}ms`));
        }, this.idleTimeoutMs);
        this.idleTimer.unref?.();
    }
    setFailure(cause) {
        if (this.failure !== undefined)
            return;
        if (cause instanceof ZcodeError)
            this.failure = cause;
        // A credential failure keeps its own code (`ZCODE_CREDENTIAL_*`): the
        // callback contract promises the error bubbles up untouched, and the code
        // is what tells an operator to re-login instead of debugging the transport.
        else if (cause instanceof ZcodeCredentialError)
            this.failure = fail(cause.code, cause.message);
        else
            this.failure = fail('ZCODE_UNKNOWN', errorText(cause));
        this.kill();
    }
    kill() {
        if (this.killed)
            return;
        this.killed = true;
        (this.deps.terminateProcessTree ?? terminateProcessTree)(this.child, record => this.log({ kind: 'zcode.appserver.taskkill', record }));
        setTimeout(() => {
            try {
                this.child.kill('SIGKILL');
            }
            catch {
                // Already gone.
            }
        }, KILL_GRACE_MS).unref?.();
    }
    log(record) {
        try {
            this.deps.logger?.(record);
        }
        catch {
            // A throwing logger must not break the channel.
        }
    }
    /** Resolve via the injected delay when present (tests), else a real timer. */
    pause(ms) {
        if (this.deps.delay !== undefined)
            return this.deps.delay(ms);
        return sleep(ms);
    }
    /** Wait until the registry answers — never judge readiness from stdout. */
    async waitReady() {
        for (let attempt = 0; attempt < READY_POLL_ATTEMPTS; attempt += 1) {
            if (this.failure !== undefined)
                throw this.failure;
            if (this.signal?.aborted === true)
                throw fail('ABORTED', 'ZCode app-server request aborted');
            try {
                const reply = await this.request('provider/refreshRegistry', { reason: 'probe' }, READY_POLL_TIMEOUT_MS);
                const result = reply.result;
                if (result?.refreshed === true)
                    return;
            }
            catch (cause) {
                if (cause instanceof ZcodeError && cause.code === 'TIMEOUT') {
                    // Not up yet; poll again.
                }
                else {
                    throw cause;
                }
            }
            await this.pause(READY_POLL_INTERVAL_MS);
        }
        throw fail('TIMEOUT', `ZCode app-server did not become ready within ${READY_POLL_ATTEMPTS} readiness probes`);
    }
    async inject(account) {
        const reply = await this.request('provider/updateAccountConfig', account.updateParams);
        const result = reply.result;
        this.log({ kind: 'zcode.appserver.injected', status: result?.status, receivedRevision: result?.receivedRevision });
        await this.request('provider/refreshRegistry', { reason: 'settings:settings-manual' });
    }
    async openSession(resumeSessionId) {
        const workspace = { workspacePath: this.deps.workspacePath, workspaceKey: this.deps.workspaceKey };
        const servers = this.deps.mcpServers ?? [];
        // Only the keys that are actually set: both request schemas are `.strict()`,
        // so an empty array is not the same as an absent key (an explicit `[]` would
        // also mean "clear the list" on resume, which is not what an unconfigured
        // bridge should say).
        const toolSurface = {
            ...(servers.length === 0
                ? {}
                : { mcpServers: servers.map(entry => ({ ...entry, headers: entry.headers.map(header => ({ ...header })) })) }),
            ...(this.deps.toolAllowlist === undefined ? {} : { toolAllowlist: [...this.deps.toolAllowlist] }),
            ...(this.deps.toolDenylist === undefined ? {} : { toolDenylist: [...this.deps.toolDenylist] }),
        };
        const reply = resumeSessionId !== undefined
            ? await this.request('session/resume', { sessionId: resumeSessionId, workspace, ...toolSurface })
            : await this.request('session/create', { workspace, ...toolSurface });
        const result = reply.result;
        const sessionId = result?.session?.sessionId ?? (resumeSessionId !== undefined ? resumeSessionId : undefined);
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
            throw fail('ZCODE_UNKNOWN', 'ZCode app-server did not return a sessionId');
        }
        this.sessionId = sessionId;
        this.thoughtLevels = (result?.session?.settings?.thoughtLevel?.available ?? [])
            .map(entry => entry?.value)
            .filter((value) => typeof value === 'string');
        this.available = (result?.session?.settings?.model?.available ?? [])
            .map(entry => ({
            providerId: typeof entry?.ref?.providerId === 'string' ? entry.ref.providerId : '',
            modelId: typeof entry?.ref?.modelId === 'string' ? entry.ref.modelId : '',
        }))
            .filter(entry => entry.providerId.length > 0 && entry.modelId.length > 0);
    }
    async send(prompt, request) {
        if (this.sessionId === undefined)
            throw fail('ZCODE_UNKNOWN', 'session/send before session/create');
        await this.request('session/subscribe', { sessionId: this.sessionId, deliveryKind: 'desktop-continuous', afterSeq: 0, includeSnapshot: false });
        const payload = () => ({
            sessionId: this.sessionId,
            content: prompt,
            // 2026-11-18:图片输入通道——CLI session/send 原生支持 attachments
            // ({type:'image', path}),桌面端拖图走的就是同一字段。
            ...(Array.isArray(request.attachments) && request.attachments.length > 0
                ? { attachments: request.attachments }
                : {}),
            modelSelection: {
                providerId: request.providerId,
                modelId: request.modelId,
                options: { reasoningLevel: request.reasoningLevel },
            },
        });
        // -32010 自愈(2026-11-18):上一轮 prompt 在这个 CLI 进程里还活着时
        // (例如上一轮 runner 提前退场后进程被复用),session/send 会被
        // "A prompt is already running for this session" 拒掉。session/stop 是
        // CLI 的强制停轮 RPC 且绕过处理队列立即执行;停掉后等被停轮次的
        // terminal 事件落袋、清场,再重发。
        for (const backoff of PROMPT_BUSY_BACKOFF_MS) {
            try {
                await this.request('session/send', payload());
                return;
            }
            catch (cause) {
                const text = errorText(cause);
                if (!/-32010/.test(text) || !/already running/i.test(text))
                    throw cause;
                this.log({ kind: 'zcode.appserver.prompt-busy', action: 'stop stale prompt and retry' });
                await this.stopActivePrompt();
                this.resetTurnState();
                await this.pause(backoff);
            }
        }
        await this.request('session/send', payload());
    }
    /** 强停当前 session 里仍活着的 prompt(session/stop 绕过 CLI 处理队列)。 */
    async stopActivePrompt() {
        if (this.sessionId === undefined || this.killed)
            return;
        try {
            await this.request('session/stop', { sessionId: this.sessionId }, 5_000);
            this.log({ kind: 'zcode.appserver.stale-prompt.stopped' });
        }
        catch (cause) {
            // 停不掉就让后续重试自然失败,把原始 -32010 暴露出来
            this.log({ kind: 'zcode.appserver.stale-prompt.stop-failed', record: errorText(cause) });
            return;
        }
        // 等被停轮次的 terminal 事件先落袋(最多 ~2s),否则它会晚到并污染
        // 下一轮的 waitForTerminal(把新轮次误判成 failed)。
        for (let i = 0; i < 20 && this.terminal === undefined && !this.killed && this.failure === undefined; i += 1)
            await this.pause(100);
    }
    /** Resolve when the terminal event arrived, the process died, or we aborted. */
    async waitForTerminal() {
        while (this.terminal === undefined && this.failure === undefined) {
            if (this.signal?.aborted === true)
                throw fail('ABORTED', 'ZCode app-server request aborted');
            await this.pause(50);
        }
        if (this.failure !== undefined && this.terminal === undefined)
            throw this.failure;
    }
    framesSnapshot = () => [...this.frames];
    /**
     * Drop one attempt's terminal state so the same process can run another.
     * Only meaningful after a failed turn whose cause is transient inside this
     * process (the registry race below); `sessionId` is left alone on purpose —
     * the retry opens a fresh session, and the abandoned one dies with the
     * process.
     */
    resetTurnState() {
        this.terminal = undefined;
        this.frames.length = 0;
    }
    close() {
        if (this.sessionId !== undefined && !this.killed && this.failure === undefined) {
            // Best effort; the child is torn down right after regardless.
            try {
                void this.request('session/close', { sessionId: this.sessionId }, 1_000).catch(() => undefined);
            }
            catch {
                // Ignore — teardown follows immediately.
            }
        }
        this.signal?.removeEventListener('abort', this.onAbort);
        if (this.idleTimer !== undefined)
            clearTimeout(this.idleTimer);
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(this.failure ?? fail('ZCODE_EXIT', 'ZCode app-server session was torn down'));
        }
        this.pending.clear();
        this.kill();
    }
}
/**
 * v3 stopReason 里的失败终端值(CLI finish-reason 枚举:"stop" 成功,
 * "tool-calls"/"other" 中间态,"error"/"length"/"content-filter" 失败终端)。
 */
const V3_TERMINAL_FAILURE_STOP_REASONS = new Set(['error', 'length', 'content-filter']);
function readPartKind(payload) {
    const value = payload['kind'];
    return typeof value === 'string' ? value : undefined;
}
function stderrTailOf(tail) {
    const trimmed = tail.trim();
    return trimmed.length === 0 ? '' : `: ${truncate(trimmed, 300)}`;
}
function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}
/**
 * The message the CLI emits when a turn is sent before the injected account
 * providers finished registering (registry race, measured 2026-10-28). The
 * string comes from the CLI itself and ships no structured code, so it is
 * matched verbatim; a CLI rename would turn the race back into a surfaced
 * failure, never into a wrong success.
 */
const REGISTRY_RACE_MESSAGE = 'Provider Registry 中不存在';
/** Backoff schedule for in-process retries after a registry race. */
const REGISTRY_RACE_BACKOFF_MS = [600, 1500, 3000];
/**
 * -32010 ("A prompt is already running for this session") self-heal backoff:
 * between `session/stop` and the resend. The stop RPC bypasses the CLI's
 * processing queue, so the waits here only cover the aborted turn's terminal
 * event draining through the subscriber.
 */
const PROMPT_BUSY_BACKOFF_MS = [600, 1500, 3000];
/**
 * 上游风控自愈(2026-11-18):CLI 自签名的 start-plan 请求偶尔被上游以 405/3012
 * "This client is not supported. Please use the official ZCode client." 拒绝——
 * 间歇性,同一会话立即重发通常就能过。按此表原地退避重试,耗尽才暴露给用户。
 */
const CLIENT_NOT_SUPPORTED_BACKOFF_MS = [500, 1200, 2500, 5000, 8000];
/**
 * Run one full turn through the app-server channel.
 *
 * @throws ZcodeError `ABORTED` (before spawn or when the signal fires),
 * `TIMEOUT` (wall clock, idle, per-request), `ZCODE_PARSE` (non-JSON stdout
 * line), `ZCODE_EXIT` (unexpected process exit or spawn failure), or
 * `ZCODE_UNKNOWN` (JSON-RPC error reply). A `planToken()` credential error is
 * re-thrown untouched — its own code, never wrapped.
 */
// 进程复用缓存(2026-11-17):per workspaceKey 保活 app-server 子进程,
// 省去每轮 spawn/ready/账号注入的 3-4 秒固定开销。空闲超时自动销毁。
const APP_SERVER_CACHE = new Map();
const APP_SERVER_IDLE_MS = 120_000;
const APP_SERVER_CACHE_MAX = 4;

function evictAppServer(key) {
    const cached = APP_SERVER_CACHE.get(key);
    if (cached !== undefined) {
        APP_SERVER_CACHE.delete(key);
        clearTimeout(cached.idleTimer);
        try {
            cached.close();
        }
        catch {
            /* 回收失败不影响主流程 */
        }
    }
}

function touchAppServer(key, session) {
    // LRU:超出上限时淘汰最久未用的一项
    while (APP_SERVER_CACHE.size >= APP_SERVER_CACHE_MAX) {
        let oldestKey = null;
        let oldest = Infinity;
        for (const [k, v] of APP_SERVER_CACHE) {
            const at = v.lastUsedAt ?? 0;
            if (at < oldest && k !== key) {
                oldest = at;
                oldestKey = k;
            }
        }
        if (oldestKey === null)
            break;
        evictAppServer(oldestKey);
    }
    const existing = APP_SERVER_CACHE.get(key);
    if (existing !== undefined && existing !== session) {
        evictAppServer(key);
    }
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => evictAppServer(key), APP_SERVER_IDLE_MS);
    session.lastUsedAt = Date.now();
    APP_SERVER_CACHE.set(key, session);
}

const APP_SERVER_LOCKS = new Map();
/**
 * per workspaceKey 串行门(2026-11-18):缓存进程按 workspaceKey 共享,主轮次、
 * 标题生成、compaction 乃至另一条会话的轮次都可能并发走到这里;并发
 * session/send 会被 CLI 以 -32010 "A prompt is already running" 拒掉,帧流也
 * 会互相污染。同一 workspace 的轮次在此排队——上层 enqueueFreeTurn 已按会话
 * 串行,这层兜住跨会话/辅助请求的并发。
 */
async function withAppServerLock(key, fn) {
    const previous = APP_SERVER_LOCKS.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    APP_SERVER_LOCKS.set(key, gate);
    try {
        await previous;
        return await fn();
    }
    finally {
        release();
        if (APP_SERVER_LOCKS.get(key) === gate)
            APP_SERVER_LOCKS.delete(key);
    }
}

export async function runZcodeAppServerTurn(deps, account, request) {
    if (request.signal?.aborted === true) {
        throw fail('ABORTED', 'ZCode app-server request aborted before start');
    }
    const cacheKey = String(deps.workspaceKey ?? 'adhoc');
    return withAppServerLock(cacheKey, () => runTurnOnSession(deps, account, request, cacheKey));
}

async function runTurnOnSession(deps, account, request, cacheKey) {
    // 流式投影:onFrame(可选)在每帧产生时同步触发,宿主据此把
    // thinking/text 实时投影成 StreamChunk,而不是等 terminal 一次性返回。
    const cached = APP_SERVER_CACHE.get(cacheKey);
    let session;
    let reused = false;
    if (cached !== undefined && !cached.killed && cached.failure === undefined && cached.childExited !== true
        && cached.busy !== true
        && cached.child !== undefined && cached.child.exitCode === null && cached.child.killed !== true) {
        // 复用保活进程:账号配置在进程内已注入,无需重打;child 死亡/已退出的一律重建
        session = cached;
        reused = true;
        session.rebindSignal(request.signal);
    }
    else {
        evictAppServer(cacheKey);
        session = new AppServerSession(request.onFrame ? { ...deps, onFrame: request.onFrame } : deps, request.signal);
        APP_SERVER_CACHE.set(cacheKey, session);
    }
    session.deps.onFrame = request.onFrame;
    session.busy = true;
    try {
        if (!reused) {
            await session.waitReady();
            await session.inject(account);
        }
        const pause = deps.delay ?? sleep;
        let attempt = 0;
        for (;;) {
            // open/send/wait 整体裹进 try:上游风控可能以「终端事件 failed」或
            // 「send()/waitForTerminal() 抛错」两种载体出现,都要能进重试判定。
            let transportError;
            let terminal;
            try {
                await session.openSession(request.resumeSessionId);
                await session.send(request.prompt, request);
                await session.waitForTerminal();
                terminal = session.terminal;
            }
            catch (cause) {
                transportError = cause;
            }
            // Registry race (measured 2026-10-28): the CLI registers the injected
            // account providers asynchronously, so a turn sent within that window
            // fails with this message and no structured code, while the identical
            // flow succeeds once the window has passed (~1s). The retry is cheap
            // and offline — fresh `session/create` + `session/send` on this same
            // process, no re-injection needed — so wait out the window and go
            // again. Matched by message text because the CLI ships no error code
            // for it; upstream rate limits and business errors carry different
            // messages and never enter this branch.
            if (transportError === undefined &&
                terminal !== undefined &&
                terminal.status === 'failed' &&
                typeof terminal.errorMessage === 'string' &&
                terminal.errorMessage.includes(REGISTRY_RACE_MESSAGE) &&
                REGISTRY_RACE_BACKOFF_MS[attempt] !== undefined) {
                session.resetTurnState();
                await pause(REGISTRY_RACE_BACKOFF_MS[attempt]);
                attempt += 1;
                continue;
            }
            // 上游风控自愈:405/3012 "This client is not supported" 间歇性出现,
            // 同一会话立即重发通常就过。终端 failed 与传输异常两种载体都按消息
            // 匹配;abort/超时/进程退出等其它错误原样上抛,绝不进这个分支。
            const failureText = transportError !== undefined
                ? errorText(transportError)
                : terminal !== undefined && terminal.status === 'failed'
                    ? (terminal.errorMessage ?? '')
                    : '';
            if (/client is not supported/i.test(failureText) &&
                CLIENT_NOT_SUPPORTED_BACKOFF_MS[attempt] !== undefined) {
                session.log({ kind: 'zcode.appserver.client-not-supported-retry', attempt: attempt + 1 });
                session.resetTurnState();
                await pause(CLIENT_NOT_SUPPORTED_BACKOFF_MS[attempt]);
                attempt += 1;
                continue;
            }
            if (transportError !== undefined)
                throw transportError;
            if (terminal === undefined) {
                throw fail('ZCODE_UNKNOWN', 'ZCode app-server turn ended without a terminal event');
            }
            touchAppServer(cacheKey, session); // 成功轮次:进程回缓存,空闲超时销毁
            return {
                frames: session.framesSnapshot(),
                zcodeSessionId: session.sessionId ?? '',
                terminal: terminal.status,
                ...(terminal.errorCode === undefined ? {} : { errorCode: terminal.errorCode }),
                ...(terminal.errorMessage === undefined ? {} : { errorMessage: terminal.errorMessage }),
                ...(terminal.responseText === undefined ? {} : { responseText: terminal.responseText }),
            };
        }
    }
    catch (cause) {
        // 失败轮次:进程状态不可信,销毁并清理缓存(下轮干净重建)
        evictAppServer(cacheKey);
        throw cause;
    }
    finally {
        session.busy = false;
        if (APP_SERVER_CACHE.get(cacheKey) !== session) {
            // 已被淘汰/未入缓存:按旧行为关闭
            session.close();
        }
        else {
            session.resetTurnState();
        }
    }
}
/**
 * Read-only probe for the settings card: spawn, inject, create, read the
 * thoughtLevel directory and the available model list, then close.
 */
export async function probeZcodeAppServerSettings(deps, account) {
    const session = new AppServerSession(deps, undefined);
    try {
        await session.waitReady();
        await session.inject(account);
        await session.openSession(undefined);
        return { thoughtLevels: session.thoughtLevels, available: session.available };
    }
    finally {
        session.close();
    }
}
//# sourceMappingURL=app-server.js.map