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
import type { ZcodeMcpServerEntry } from '../mcp/bridge.js';
/** One projected output frame, in arrival order. */
export interface ZcodeAppServerFrame {
    readonly kind: 'text' | 'thinking' | 'usage' | 'finish' | 'error' | 'unknown';
    readonly text?: string;
    readonly usage?: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens?: number;
        readonly cacheReadTokens?: number;
        readonly cacheCreationTokens?: number;
    };
    readonly stopReason?: string;
    readonly errorCode?: string;
    readonly errorMessage?: string;
    readonly raw?: string;
}
export interface ZcodeAppServerDeps {
    readonly nodePath: string;
    readonly zcodeCjsPath: string;
    readonly env: Readonly<Record<string, string>>;
    readonly workspacePath: string;
    readonly workspaceKey: string;
    /** Fetched fresh on every model-request header callback (token may rotate). */
    readonly planToken: () => string;
    readonly logger?: ((record: unknown) => void) | undefined;
    readonly spawn?: typeof import('node:child_process').spawn;
    readonly timeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxOutputBytes?: number;
    /**
     * MCP servers handed to `session/create` / `session/resume`.
     *
     * This is the DSH tool bridge's descriptor (see `src/mcp/bridge.ts`): ZCode
     * acts as an MCP client and calls back into the host, so the tools a model
     * sees are the host's own rather than the CLI's built-ins.
     */
    readonly mcpServers?: readonly ZcodeMcpServerEntry[] | undefined;
    /**
     * Tool-surface filters passed through to the CLI verbatim.
     *
     * Both keys exist in the CLI's strict `session/create` schema, but what they
     * filter — and whether the names are bare or `mcp__server__tool` — was never
     * measured on this machine. They are configuration pass-through only.
     */
    readonly toolAllowlist?: readonly string[] | undefined;
    readonly toolDenylist?: readonly string[] | undefined;
    /** Injectable sleep for tests: microtask-scheduled waits stay off the real
     * timer wheel, so a 60-probe readiness loop can't interact with the test
     * runner's timer bookkeeping (the OOM in `tests/app-server.test.mjs`). */
    readonly delay?: ((ms: number) => Promise<void>) | undefined;
    /** Injectable process-tree teardown (defaults to the real taskkill helper). */
    readonly terminateProcessTree?: ((child: import('node:child_process').ChildProcess, log: (record: unknown) => void) => void | Promise<void>) | undefined;
}
export interface ZcodeAppServerTurnRequest {
    /** The injected providerId (`buildZcodeAccountConfig().providerId`). */
    readonly providerId: string;
    readonly modelId: string;
    readonly reasoningLevel: string;
    readonly prompt: string;
    readonly resumeSessionId?: string;
    readonly signal?: AbortSignal;
}
export interface ZcodeAppServerTurnResult {
    readonly frames: readonly ZcodeAppServerFrame[];
    readonly zcodeSessionId: string;
    readonly terminal: 'success' | 'failed';
    /** Final assistant text from the terminal event (short turns skip streaming). */
    readonly responseText?: string | undefined;
    readonly errorCode?: string;
    readonly errorMessage?: string;
}
export interface ZcodeAppServerSettings {
    readonly thoughtLevels: readonly string[];
    readonly available: readonly {
        providerId: string;
        modelId: string;
    }[];
}
/**
 * Run one full turn through the app-server channel.
 *
 * @throws ZcodeError `ABORTED` (before spawn or when the signal fires),
 * `TIMEOUT` (wall clock, idle, per-request), `ZCODE_PARSE` (non-JSON stdout
 * line), `ZCODE_EXIT` (unexpected process exit or spawn failure), or
 * `ZCODE_UNKNOWN` (JSON-RPC error reply). A `planToken()` credential error is
 * re-thrown untouched — its own code, never wrapped.
 */
export declare function runZcodeAppServerTurn(deps: ZcodeAppServerDeps, account: {
    readonly updateParams: unknown;
}, request: ZcodeAppServerTurnRequest): Promise<ZcodeAppServerTurnResult>;
/**
 * Read-only probe for the settings card: spawn, inject, create, read the
 * thoughtLevel directory and the available model list, then close.
 */
export declare function probeZcodeAppServerSettings(deps: ZcodeAppServerDeps, account: {
    readonly updateParams: unknown;
}): Promise<ZcodeAppServerSettings>;
//# sourceMappingURL=app-server.d.ts.map