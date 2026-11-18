/**
 * Process layer of the ZCode provider: environment contract, argv assembly, and
 * the supervised child process.
 *
 * ZCode 0.17.0 is a Node program (`resources/glm/zcode.cjs`) that runs one turn
 * per `-p` invocation. Nothing here parses the JSON it prints — that is the
 * parser's job — this module only guarantees four things the rest of the
 * provider relies on:
 *
 * 1. the environment contract is complete *before* anything is spawned
 *    (fail-closed: a partial environment makes ZCode die 714 ms in with a
 *    message far from the cause);
 * 2. the argv is built by a pure function that can never emit `--mode yolo`;
 * 3. the child is supervised — wall clock, inactivity, output budget, abort —
 *    and its whole process tree is terminated on every exit path;
 * 4. stdout arrives as complete lines, so the parser never sees a half frame.
 */
import { spawn } from 'node:child_process';
import { ZcodeError, boundStderrTail, classifyStderr } from '../provider/error-codes.js';
/**
 * The ZCode environment contract, as one table.
 *
 * `assertEnvContract()` is the only consumer, and it is fail-closed: a missing
 * entry stops the request before a process exists. Every `expected` value below
 * reflects this host as of 2026-11-18 (after bootstrap-env.js took over
 * derivation — the pre-bootstrap F:\AgentData\… values of the original host are
 * gone). ZCODE_BUILTIN/PERSONAL are bootstrap-*derived* (mtime scan of the
 * desktop runtime tree / CLI-filtered copy), so they drift with desktop updates;
 * doctor treats a diff as `warn`, never `fail`.
 */
export const ZCODE_ENV_CONTRACT = [
    {
        name: 'ZCODE_HOME',
        expected: 'C:\\Users\\Administrator\\.zcode',
        note: 'Bootstrap root; without it ZCode cannot create its store manager and exits during startup.',
    },
    {
        name: 'ZCODE_DATA_BASE_DIR',
        expected: 'C:\\Users\\Administrator',
        note: 'Parent of ZCODE_HOME; without it the same bootstrap step fails.',
    },
    {
        name: 'ZCODE_BUILTIN_PROVIDER_CONFIG_FILE',
        expected: 'C:\\Users\\Administrator\\.zcode\\v2\\runtime\\provider\\windows-x86_64\\0.0.0-dev\\endpoint-78d7c3bef4024722642626fe3669a799\\zcode-builtin.json',
        note: 'Built-in provider config, discovered by bootstrap from the newest desktop runtime snapshot; when missing ZCode exits within ~714 ms with "无法定位 CLI ZCode Built-in Provider Config".',
    },
    {
        name: 'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE',
        expected: 'C:\\Users\\Administrator\\zcode-provider\\provider_config.cli.json',
        note: 'Personal provider config as derived for the CLI (loopback-bridge providers filtered out). Supplying only one of the built-in/personal pair makes ZCode reject both with "必须同时提供".',
    },
    {
        name: 'NODE_OPTIONS',
        expected: '--no-network-family-autoselection --dns-result-order=ipv4first',
        note: 'IPv4-first DNS. On dual-stack hosts the ZCode HTTP client otherwise fails with an empty AggregateError surfaced only as "Cannot connect to API:".',
    },
];
/** Node floor: ZCode 0.17.0 loads `node:sqlite`, which exists from Node 22. */
export const MIN_NODE_MAJOR = 22;
/**
 * Contract entries the provider can supply itself.
 *
 * `NODE_OPTIONS` is the only one: the two DNS flags are a transport fix, not an
 * installation fact, so the provider merges them into the child environment at
 * spawn time instead of demanding that the user write a global variable.
 */
/**
 * `NODE_OPTIONS` is the one contract entry the provider supplies itself, so a
 * host without it is not "missing": the value is assembled at spawn time from
 * {@link NODE_OPTIONS_REQUIRED} and any host value must pass the same allowlist.
 */
const SELF_SUPPLIED_ENV = new Set(['NODE_OPTIONS']);
/** Flags the provider always contributes to `NODE_OPTIONS`. */
export const NODE_OPTIONS_REQUIRED = ['--no-network-family-autoselection', '--dns-result-order=ipv4first'];
/** Names of the contract entries that are absent or blank in `env`. */
export function missingEnvKeys(env) {
    const missing = [];
    for (const entry of ZCODE_ENV_CONTRACT) {
        if (SELF_SUPPLIED_ENV.has(entry.name))
            continue;
        const value = env[entry.name];
        if (value === undefined || value.trim().length === 0)
            missing.push(entry.name);
    }
    return missing;
}
/**
 * Fail-closed environment check.
 *
 * @param env - the environment the child will inherit.
 * @returns the resolved contract values (present entries only).
 * @throws ZcodeError `ZCODE_ENV_MISSING` naming every missing entry and the
 * value it must carry. The message is the whole point: an operator who reads
 * only the log line must be able to fix the host from it.
 */
export function assertEnvContract(env) {
    const missing = missingEnvKeys(env);
    if (missing.length > 0) {
        const detail = missing
            .map((name) => {
            const entry = ZCODE_ENV_CONTRACT.find(candidate => candidate.name === name);
            return `${name} (expected ${entry?.expected ?? 'unknown'})`;
        })
            .join('; ');
        throw new ZcodeError('ZCODE_ENV_MISSING', `ZCode environment contract is incomplete: missing ${detail}`, { stderrTail: `missing: ${missing.join(', ')}` });
    }
    const resolved = {};
    for (const entry of ZCODE_ENV_CONTRACT) {
        if (SELF_SUPPLIED_ENV.has(entry.name))
            continue;
        const value = env[entry.name];
        if (value !== undefined)
            resolved[entry.name] = value;
    }
    resolved['NODE_OPTIONS'] = resolveNodeOptions(env['NODE_OPTIONS']);
    return resolved;
}
/**
 * Validate and complete a `NODE_OPTIONS` value.
 *
 * Value-level allowlist: the only tokens that may reach the child are the two
 * documented DNS flags. Anything else — loader/eval switches first of all — is
 * refused before a process exists, because `NODE_OPTIONS` is inherited by the
 * child Node process and a planted `--require` would run arbitrary code there.
 *
 * @throws ZcodeError `ZCODE_ENV_MISSING` when the value carries any other token.
 */
export function resolveNodeOptions(value) {
    const tokens = (value ?? '').trim().split(/\s+/).filter(token => token.length > 0);
    const allowed = new Set(NODE_OPTIONS_REQUIRED);
    for (const token of tokens) {
        if (!allowed.has(token)) {
            throw new ZcodeError('ZCODE_ENV_MISSING', `NODE_OPTIONS carries an unsupported flag "${token}"; `
                + `this provider only accepts ${NODE_OPTIONS_REQUIRED.join(' ')}`, { stderrTail: 'unsupported NODE_OPTIONS flag' });
        }
    }
    const merged = [...tokens];
    for (const required of NODE_OPTIONS_REQUIRED) {
        if (!merged.includes(required))
            merged.push(required);
    }
    return merged.join(' ');
}
/** Shape a `passEnv` entry must have; anything else is dropped, never passed. */
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Build the child environment from a closed allowlist.
 *
 * The child sees the operating-system variables Node itself needs plus the five
 * contract entries (and `passEnv` names the operator opted into) — never the
 * whole host environment. `request.env` is the *source*, so a test that passes
 * a fake environment gets exactly that: nothing from `process.env` leaks in.
 */
export function buildChildEnv(options) {
    const env = {};
    for (const key of ZCODE_ENV_ALLOWLIST) {
        const value = options.source[key];
        if (value !== undefined && value.length > 0)
            env[key] = value;
    }
    for (const key of options.passEnv ?? []) {
        if (!ENV_NAME_PATTERN.test(key))
            continue;
        const value = options.source[key];
        if (value !== undefined)
            env[key] = value;
    }
    for (const [key, value] of Object.entries(options.contract))
        env[key] = value;
    return env;
}
/** The operating-system variables the child inherits; everything else is closed.
 *
 *  `ZCODE_APP_VERSION` is the one app-level exception (2026-11-18): the CLI builds
 *  `x-zcode-app-version` from it, and zcode.z.ai rejects turns with the stale
 *  build-in version (3012 "client not supported"). bootstrap-env.js derives it
 *  from the active desktop runtime snapshot when the host env lacks it.
 */
export const ZCODE_ENV_ALLOWLIST = [
    'PATH',
    'SystemRoot',
    'SystemDrive',
    'windir',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'COMSPEC',
    'PATHEXT',
    'ZCODE_APP_VERSION',
];
/** The permission mode this provider is allowed to use. */
const GUARDED_MODE = 'guarded';
/**
 * Build the ZCode CLI arguments after the entry script path (pure).
 *
 * The shape is fixed by ZCode 0.17.0:
 * `-p <prompt> --mode guarded --json --cwd <cwd> [--resume <sess_…>] [--verbose]`.
 *
 * `--mode` is emitted unconditionally and validated here, so no configuration
 * path can reach `yolo` (which auto-approves every tool call). `--model`,
 * `--effort`, `--agent`, `--json-schema` and `--input-format` are deliberately
 * absent: ZCode 0.17.0 does not accept them, and a rejected option surfaces as
 * a generic business error rather than a usage error.
 *
 * @throws TypeError when an argument would be ambiguous on the command line.
 */
export function buildZcodeArgs(options) {
    const { prompt, cwd } = options;
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new TypeError('buildZcodeArgs: prompt must be a non-empty string');
    }
    if (typeof cwd !== 'string' || cwd.trim().length === 0) {
        throw new TypeError('buildZcodeArgs: cwd must be a non-empty string');
    }
    if (cwd.startsWith('-')) {
        throw new TypeError(`buildZcodeArgs: cwd must not start with "-" (got ${cwd})`);
    }
    const mode = options.mode ?? GUARDED_MODE;
    if (mode !== GUARDED_MODE) {
        throw new TypeError(`buildZcodeArgs: mode must be "${GUARDED_MODE}" (got ${String(mode)})`);
    }
    const args = ['-p', prompt, '--mode', GUARDED_MODE, '--json', '--cwd', cwd];
    const sessionId = options.sessionId?.trim();
    if (options.resume === true && sessionId !== undefined && sessionId.length > 0) {
        if (sessionId.startsWith('-')) {
            throw new TypeError(`buildZcodeArgs: sessionId must not start with "-" (got ${sessionId})`);
        }
        args.push('--resume', sessionId);
    }
    if (options.verbose === true)
        args.push('--verbose');
    return args;
}
/** Bytes of stdout/stderr retained for diagnostics. */
const TAIL_MAX_BYTES = 8_192;
/** Grace before a termination escalates from the polite kill to SIGKILL. */
const KILL_GRACE_MS = 3_000;
/**
 * Terminate the child and everything it started.
 *
 * On Windows the process tree is killed with `taskkill /t /f`, because ZCode
 * spawns its own workers and a bare `child.kill()` would leave them holding the
 * session directory. Detached process groups cover POSIX.
 *
 * `spawnFn` exists for tests: a taskkill that fails asynchronously must surface
 * as a diagnostic, not as an uncaught `error` event in the host.
 */
export function terminateProcessTree(child, onDiagnostic, spawnFn = spawn) {
    const pid = child.pid;
    if (pid === undefined)
        return;
    if (process.platform === 'win32') {
        try {
            const killer = spawnFn('taskkill', ['/pid', String(pid), '/t', '/f'], { shell: false, windowsHide: true, stdio: 'ignore' });
            // A spawn that fails asynchronously (taskkill missing, no handle) emits
            // 'error' on the ChildProcess; without a listener it would become an
            // uncaught exception in the host process.
            killer.on('error', (error) => {
                onDiagnostic?.({ kind: 'zcode.process.taskkill.failed', pid, message: errorText(error) });
                try {
                    child.kill('SIGKILL');
                }
                catch {
                    // Already gone.
                }
            });
        }
        catch {
            child.kill('SIGKILL');
        }
        return;
    }
    try {
        process.kill(-pid, 'SIGKILL');
    }
    catch {
        child.kill('SIGKILL');
    }
}
function appendTail(current, chunk) {
    const combined = current + chunk;
    return combined.length <= TAIL_MAX_BYTES ? combined : combined.slice(combined.length - TAIL_MAX_BYTES);
}
/**
 * Run one ZCode child process under supervision.
 *
 * Never rejects for a child-level failure: every termination mode is reported
 * through the result, so the caller decides whether it is an error (see
 * {@link runZcode}). It only rejects for a spawn failure that never created a
 * process, which is reported as `ZCODE_ENV_MISSING` when the executable or
 * script path does not exist.
 */
export function spawnZcode(request) {
    const { nodePath, zcodeCjsPath, args, cwd, env, timeoutMs, idleTimeoutMs, maxOutputBytes, maxEventLineLength, stdinMode = 'hold', signal, } = request;
    if (signal?.aborted === true) {
        return Promise.reject(new ZcodeError('ABORTED', 'ZCode request aborted before start'));
    }
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(nodePath, [zcodeCjsPath, ...args], {
                cwd,
                env,
                shell: false,
                detached: process.platform !== 'win32',
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        catch (cause) {
            reject(new ZcodeError('ZCODE_EXIT', `Unable to spawn ZCode: ${errorText(cause)}`, { cause }));
            return;
        }
        let termination;
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stdoutTail = '';
        let stderrTail = '';
        let stdoutBuffer = '';
        let lineOverflow = false;
        let settled = false;
        let stdinClosed = false;
        let wallTimer;
        let idleTimer;
        let graceTimer;
        const clearTimers = () => {
            if (wallTimer !== undefined)
                clearTimeout(wallTimer);
            if (idleTimer !== undefined)
                clearTimeout(idleTimer);
            if (graceTimer !== undefined)
                clearTimeout(graceTimer);
            wallTimer = undefined;
            idleTimer = undefined;
            graceTimer = undefined;
        };
        const finish = () => {
            if (settled)
                return;
            settled = true;
            clearTimers();
            signal?.removeEventListener('abort', onAbort);
            if (stdoutBuffer.length > 0) {
                request.onStdoutLine?.(stdoutBuffer);
                stdoutBuffer = '';
            }
            const exitCode = typeof child.exitCode === 'number' ? child.exitCode : null;
            const exitSignal = child.signalCode ?? null;
            const final = termination ?? (exitCode === 0 ? 'completed' : exitSignal === null ? 'non-zero' : 'signaled');
            resolve({
                termination: final,
                exitCode,
                signal: exitSignal,
                stdoutBytes,
                stderrBytes,
                stdoutTail,
                stderrTail,
                durationMs: Date.now() - startedAt,
                lineOverflow,
            });
        };
        const kill = (reason) => {
            if (termination !== undefined)
                return;
            termination = reason;
            if (!stdinClosed)
                endStdin();
            terminateProcessTree(child, request.onDiagnostic);
            // taskkill /t /f normally settles the child at once; this is the backstop
            // for a tree that ignores it and would otherwise hang the request forever.
            graceTimer = setTimeout(() => {
                if (settled)
                    return;
                try {
                    child.kill('SIGKILL');
                }
                catch {
                    // Already gone.
                }
                finish();
            }, KILL_GRACE_MS);
            graceTimer.unref?.();
        };
        const endStdin = () => {
            if (stdinClosed)
                return;
            stdinClosed = true;
            try {
                child.stdin?.end();
            }
            catch {
                // The pipe may already be broken; nothing to recover.
            }
        };
        const armIdle = () => {
            if (idleTimer !== undefined)
                clearTimeout(idleTimer);
            idleTimer = setTimeout(() => kill('idle-timeout'), idleTimeoutMs);
            idleTimer.unref?.();
        };
        const onAbort = () => kill('aborted');
        child.once('error', (cause) => {
            if (settled)
                return;
            settled = true;
            clearTimers();
            signal?.removeEventListener('abort', onAbort);
            const code = cause.code;
            const missingExecutable = code === 'ENOENT';
            reject(new ZcodeError(missingExecutable ? 'ZCODE_ENV_MISSING' : 'ZCODE_EXIT', missingExecutable
                ? `ZCode executable not found: ${nodePath} or entry script ${zcodeCjsPath}`
                : `ZCode process failed to start: ${errorText(cause)}`, { cause }));
        });
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            if (termination !== undefined)
                return;
            stdoutBytes += Buffer.byteLength(chunk, 'utf8');
            stdoutTail = appendTail(stdoutTail, chunk);
            armIdle();
            if (stdoutBytes > maxOutputBytes) {
                kill('output-limit');
                return;
            }
            stdoutBuffer += chunk;
            let newline = stdoutBuffer.indexOf('\n');
            while (newline >= 0) {
                const rawLine = stdoutBuffer.slice(0, newline).replace(/\r$/, '');
                stdoutBuffer = stdoutBuffer.slice(newline + 1);
                if (rawLine.length > maxEventLineLength) {
                    lineOverflow = true;
                    kill('output-limit');
                    return;
                }
                request.onStdoutLine?.(rawLine);
                newline = stdoutBuffer.indexOf('\n');
            }
            if (stdoutBuffer.length > maxEventLineLength) {
                lineOverflow = true;
                kill('output-limit');
            }
        });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk) => {
            if (termination !== undefined)
                return;
            stderrBytes += Buffer.byteLength(chunk, 'utf8');
            stderrTail = appendTail(stderrTail, chunk);
            request.onStderrChunk?.(chunk);
            armIdle();
            if (stderrBytes > maxOutputBytes)
                kill('output-limit');
        });
        child.once('close', () => {
            if (graceTimer !== undefined) {
                clearTimeout(graceTimer);
                graceTimer = undefined;
            }
            finish();
        });
        if (request.stdin !== undefined) {
            try {
                child.stdin?.write(request.stdin);
            }
            catch {
                // A child that died before reading the prompt is reported through the
                // exit path; the write failure carries no extra information.
            }
        }
        if (stdinMode === 'close')
            endStdin();
        wallTimer = setTimeout(() => kill('timeout'), timeoutMs);
        wallTimer.unref?.();
        armIdle();
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/**
 * End-to-end supervised run: concurrency gate, environment contract, argv,
 * spawn, and error classification.
 *
 * The prompt goes over argv (`-p`), which is the only input channel ZCode 0.17.0
 * documents for a one-shot turn; stdin is used only to keep the pipe's lifetime
 * under `stdinMode` control.
 *
 * @throws ZcodeError on any terminating condition that is not a clean exit.
 */
export async function runZcode(request) {
    const { config } = request;
    // `request.env` is the environment *source*: a fake env handed in by a test
    // must be the only thing the child sees (no process.env merge).
    const sourceEnv = request.env ?? process.env;
    const contract = assertEnvContract(sourceEnv);
    const childEnv = buildChildEnv({ source: sourceEnv, contract, passEnv: request.passEnv });
    const args = buildZcodeArgs({
        prompt: request.prompt,
        cwd: request.cwd,
        sessionId: request.sessionId,
        resume: request.resume,
        verbose: request.verbose,
    });
    const release = await acquireSlot(config);
    try {
        const result = await spawnZcode({
            nodePath: config.nodePath,
            zcodeCjsPath: config.zcodeCjsPath,
            args,
            cwd: request.cwd,
            env: childEnv,
            timeoutMs: config.timeoutMs,
            idleTimeoutMs: config.idleTimeoutMs,
            maxOutputBytes: config.maxOutputBytes,
            maxEventLineLength: config.maxEventLineLength,
            stdinMode: config.stdinMode,
            signal: request.signal,
            onStdoutLine: request.onStdoutLine,
            onDiagnostic: request.onDiagnostic,
        });
        assertCleanExit(result);
        return { ...result, argv: [config.nodePath, config.zcodeCjsPath, ...args] };
    }
    finally {
        release();
    }
}
/** Turn a termination mode into a {@link ZcodeError}, if it is not a clean exit. */
export function assertCleanExit(result) {
    switch (result.termination) {
        case 'completed':
            return;
        case 'aborted':
            throw new ZcodeError('ABORTED', 'ZCode request was aborted', { stderrTail: result.stderrTail });
        case 'timeout':
            throw new ZcodeError('TIMEOUT', `ZCode exceeded its wall-clock budget (${result.durationMs} ms)`, { stderrTail: result.stderrTail });
        case 'idle-timeout':
            throw new ZcodeError('TIMEOUT', `ZCode produced no output for longer than its inactivity budget (${result.durationMs} ms)`, { stderrTail: result.stderrTail });
        case 'output-limit':
            throw new ZcodeError('ZCODE_OUTPUT_TOO_LARGE', result.lineOverflow
                ? 'ZCode emitted a stdout line beyond maxEventLineLength'
                : 'ZCode output exceeded maxOutputBytes', { stderrTail: result.stderrTail });
        case 'non-zero':
        case 'signaled':
            throw classifyStderr(result.stderrTail, { exitCode: result.exitCode, signal: result.signal });
        default:
            throw new ZcodeError('ZCODE_UNKNOWN', `ZCode ended with an unmapped termination: ${String(result.termination)}`, { stderrTail: result.stderrTail });
    }
}
let activeProcesses = 0;
const waitingProcesses = [];
/**
 * Serialize processes behind `maxConcurrent`, with a bounded queue.
 *
 * Kept module-level because the gate belongs to this host, not to one request:
 * two adapters sharing a config must still respect a single process ceiling.
 */
function acquireSlot(config) {
    const limit = Math.max(1, config.maxConcurrent);
    const release = () => {
        const next = waitingProcesses.shift();
        if (next !== undefined)
            next();
        else
            activeProcesses = Math.max(0, activeProcesses - 1);
    };
    if (activeProcesses < limit) {
        activeProcesses += 1;
        return Promise.resolve(release);
    }
    if (waitingProcesses.length >= Math.max(0, config.maxQueue)) {
        return Promise.reject(new ZcodeError('ZCODE_BUSY', `ZCode queue is full (${config.maxQueue} waiting)`));
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            const index = waitingProcesses.indexOf(grant);
            if (index >= 0)
                waitingProcesses.splice(index, 1);
            reject(new ZcodeError('TIMEOUT', `ZCode queue wait exceeded ${config.queueTimeoutMs} ms`));
        }, config.queueTimeoutMs);
        timer.unref?.();
        const grant = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(release);
        };
        waitingProcesses.push(grant);
    });
}
function errorText(cause) {
    if (cause instanceof Error)
        return cause.message;
    return String(cause);
}
/** Re-export so consumers of this module need one import for the error type. */
export { ZcodeError, classifyStderr, boundStderrTail };
//# sourceMappingURL=process.js.map