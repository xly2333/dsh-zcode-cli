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
import { spawn, type ChildProcess } from 'node:child_process';
import { ZcodeError, boundStderrTail, classifyStderr } from '../provider/error-codes.js';
/** One entry of the ZCode environment contract. */
export interface ZcodeEnvContractEntry {
    /** Environment variable name. */
    readonly name: string;
    /** The value this host must carry, with the evidence behind it in `note`. */
    readonly expected: string;
    /** Trailing note recording why the entry exists and what breaks without it. */
    readonly note: string;
}
/**
 * The ZCode environment contract, as one table.
 *
 * `assertEnvContract()` is the only consumer, and it is fail-closed: a missing
 * entry stops the request before a process exists. Every `expected` value below
 * was read from this host's ZCode 0.17.0 installation on 2026-10-24; they are
 * recorded here so a future install can diff against them instead of guessing
 * from a ZCode stack trace.
 */
export declare const ZCODE_ENV_CONTRACT: readonly ZcodeEnvContractEntry[];
/** Node floor: ZCode 0.17.0 loads `node:sqlite`, which exists from Node 22. */
export declare const MIN_NODE_MAJOR = 22;
/** Flags the provider always contributes to `NODE_OPTIONS`. */
export declare const NODE_OPTIONS_REQUIRED: readonly ["--no-network-family-autoselection", "--dns-result-order=ipv4first"];
/** A process environment as seen by the contract check. */
export type ZcodeEnv = Readonly<Record<string, string | undefined>>;
/** Names of the contract entries that are absent or blank in `env`. */
export declare function missingEnvKeys(env: ZcodeEnv): string[];
/**
 * Fail-closed environment check.
 *
 * @param env - the environment the child will inherit.
 * @returns the resolved contract values (present entries only).
 * @throws ZcodeError `ZCODE_ENV_MISSING` naming every missing entry and the
 * value it must carry. The message is the whole point: an operator who reads
 * only the log line must be able to fix the host from it.
 */
export declare function assertEnvContract(env: ZcodeEnv): Record<string, string>;
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
export declare function resolveNodeOptions(value: string | undefined): string;
/** Shape a `passEnv` entry must have; anything else is dropped, never passed. */
export declare const ENV_NAME_PATTERN: RegExp;
/**
 * Build the child environment from a closed allowlist.
 *
 * The child sees the operating-system variables Node itself needs plus the five
 * contract entries (and `passEnv` names the operator opted into) — never the
 * whole host environment. `request.env` is the *source*, so a test that passes
 * a fake environment gets exactly that: nothing from `process.env` leaks in.
 */
export declare function buildChildEnv(options: {
    readonly source: ZcodeEnv;
    readonly contract: Readonly<Record<string, string>>;
    readonly passEnv?: readonly string[] | undefined;
}): NodeJS.ProcessEnv;
/** The operating-system variables the child inherits; everything else is closed. */
export declare const ZCODE_ENV_ALLOWLIST: readonly ["PATH", "SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC", "PATHEXT"];
/** Options of {@link buildZcodeArgs}. */
export interface BuildZcodeArgsOptions {
    /** The whole user turn, written verbatim after `-p`. */
    readonly prompt: string;
    /** Session working directory; passed as `--cwd`. */
    readonly cwd: string;
    /** ZCode session id to resume, e.g. `sess_…`. Only used when `resume` is true. */
    readonly sessionId?: string | undefined;
    /** Mirror of `config.sessionMode === 'resume'`; the caller owns that decision. */
    readonly resume?: boolean | undefined;
    /** Add `--verbose`, which makes ZCode print the underlying transport cause. */
    readonly verbose?: boolean | undefined;
    /** Must be `guarded` when present; any other value is rejected, never passed through. */
    readonly mode?: string | undefined;
}
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
export declare function buildZcodeArgs(options: BuildZcodeArgsOptions): string[];
/** How a supervised child process ended. */
export type ZcodeTermination = 'completed' | 'non-zero' | 'signaled' | 'aborted' | 'timeout' | 'idle-timeout' | 'output-limit';
/** Request of {@link spawnZcode}. */
export interface ZcodeSpawnRequest {
    /** Node executable, e.g. `D:\nodejs\node.exe`. */
    readonly nodePath: string;
    /** ZCode entry script, e.g. `…\resources\glm\zcode.cjs`. */
    readonly zcodeCjsPath: string;
    /** CLI arguments from {@link buildZcodeArgs}. */
    readonly args: readonly string[];
    /** Working directory of the child. */
    readonly cwd: string;
    /** Full environment handed to the child. */
    readonly env: NodeJS.ProcessEnv;
    /** Wall-clock ceiling in ms; only an endlessly printing child can reach it. */
    readonly timeoutMs: number;
    /** Inactivity budget in ms, re-armed on every output chunk. */
    readonly idleTimeoutMs: number;
    /** Combined stdout/stderr byte budget; exceeding it kills the child. */
    readonly maxOutputBytes: number;
    /** Longest single stdout line; a longer line kills the child. */
    readonly maxEventLineLength: number;
    /** `hold` keeps stdin open until exit, `close` ends it as soon as the prompt is written. */
    readonly stdinMode?: 'hold' | 'close' | undefined;
    /** Text written to the child's stdin (the prompt when the caller wants it on the pipe). */
    readonly stdin?: string | undefined;
    /** Cancel signal; the whole process tree is terminated. */
    readonly signal?: AbortSignal | undefined;
    /** Called once per complete stdout line, in arrival order. */
    readonly onStdoutLine?: ((line: string) => void) | undefined;
    /** Called once per stderr chunk. */
    readonly onStderrChunk?: ((chunk: string) => void) | undefined;
    /** Called with process-layer diagnostics (e.g. a failed taskkill). */
    readonly onDiagnostic?: ((record: unknown) => void) | undefined;
}
/** Result of {@link spawnZcode}. */
export interface ZcodeSpawnResult {
    readonly termination: ZcodeTermination;
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly stdoutBytes: number;
    readonly stderrBytes: number;
    /** Bounded tail of stdout, for diagnostics only. */
    readonly stdoutTail: string;
    /** Bounded tail of stderr, for classification and diagnostics. */
    readonly stderrTail: string;
    readonly durationMs: number;
    readonly lineOverflow: boolean;
}
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
export declare function terminateProcessTree(child: Pick<ChildProcess, 'pid' | 'kill'>, onDiagnostic?: ((record: unknown) => void) | undefined, spawnFn?: typeof spawn): void;
/**
 * Run one ZCode child process under supervision.
 *
 * Never rejects for a child-level failure: every termination mode is reported
 * through the result, so the caller decides whether it is an error (see
 * {@link runZcode}). It only rejects for a spawn failure that never created a
 * process, which is reported as `ZCODE_ENV_MISSING` when the executable or
 * script path does not exist.
 */
export declare function spawnZcode(request: ZcodeSpawnRequest): Promise<ZcodeSpawnResult>;
/** Request of {@link runZcode}. */
export interface ZcodeRunRequest {
    /** Config subset the process layer needs. */
    readonly config: ZcodeProcessConfig;
    /** The whole user turn. */
    readonly prompt: string;
    /** Session working directory. */
    readonly cwd: string;
    /** Resumed ZCode session id, when the caller has one. */
    readonly sessionId?: string | undefined;
    /** Mirror of `config.sessionMode === 'resume'`. */
    readonly resume?: boolean | undefined;
    /** Run with `--verbose` so a failure carries its cause line. */
    readonly verbose?: boolean | undefined;
    /** Override the inherited environment (tests pass a fake contract). */
    readonly env?: ZcodeEnv | undefined;
    /** Extra host variable names the child may inherit, on top of the closed allowlist. */
    readonly passEnv?: readonly string[] | undefined;
    /** Called with process-layer diagnostics (e.g. a failed taskkill). */
    readonly onDiagnostic?: ((record: unknown) => void) | undefined;
    /** Cancel signal. */
    readonly signal?: AbortSignal | undefined;
    /** Called once per stdout line. */
    readonly onStdoutLine?: ((line: string) => void) | undefined;
}
/** The config fields the process layer reads. */
export interface ZcodeProcessConfig {
    readonly nodePath: string;
    readonly zcodeCjsPath: string;
    readonly timeoutMs: number;
    readonly idleTimeoutMs: number;
    readonly stdinMode: 'hold' | 'close';
    readonly maxOutputBytes: number;
    readonly maxEventLineLength: number;
    readonly maxConcurrent: number;
    readonly maxQueue: number;
    readonly queueTimeoutMs: number;
}
/** Result of {@link runZcode}. */
export interface ZcodeRunResult extends ZcodeSpawnResult {
    /** The argv that was executed, for diagnostics. */
    readonly argv: readonly string[];
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
export declare function runZcode(request: ZcodeRunRequest): Promise<ZcodeRunResult>;
/** Turn a termination mode into a {@link ZcodeError}, if it is not a clean exit. */
export declare function assertCleanExit(result: ZcodeSpawnResult): void;
/** Re-export so consumers of this module need one import for the error type. */
export { ZcodeError, classifyStderr, boundStderrTail };
//# sourceMappingURL=process.d.ts.map