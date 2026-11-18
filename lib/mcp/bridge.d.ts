import { type DshWebServerLike, type McpEndpoint } from './endpoint.js';
export type { DshWebServerLike, McpEndpoint };
import { type DshToolRegistryLike } from './tool-projection.js';
/** The subset of the DSH tool registry this bridge uses. */
export interface DshToolRuntimeLike extends DshToolRegistryLike {
    execute(execution: {
        readonly callId: unknown;
        readonly name: string;
        readonly arguments: unknown;
        readonly agent?: unknown;
        readonly signal: AbortSignal;
    }): Promise<DshToolExecutionResultLike>;
}
export interface DshToolExecutionResultLike {
    readonly isError: boolean;
    readonly error?: {
        readonly message?: unknown;
    } | undefined;
    readonly value?: unknown;
    readonly content?: readonly unknown[];
}
/** The host service that resolves a session id to its live Agent. */
export interface DshSessionControllerLike {
    resolveAgent(sessionId: unknown): Promise<unknown>;
}
export interface DshMcpBridgeOptions {
    readonly webServer: DshWebServerLike;
    readonly tools: DshToolRuntimeLike;
    readonly sessionController?: DshSessionControllerLike | undefined;
    /**
     * Late-bound `sessionController` lookup.
     *
     * The bridge starts while this plugin loads, and the Session controller is
     * mounted by a different bundle: reading the service once at start can pin
     * `undefined` for the whole host lifetime, which silently degrades every
     * scoped query to the global tool view (the file and shell tools live on the
     * agent plane). Resolving per turn removes the load-order dependency.
     */
    readonly sessionControllerLookup?: (() => DshSessionControllerLike | undefined) | undefined;
    /** Optional allowlist of DSH tool names exposed to ZCode. */
    readonly toolAllowlist?: readonly string[] | undefined;
    readonly serverVersion: string;
    readonly logger?: (message: string) => void;
}
/** Server name ZCode sees, and the prefix of every projected tool name. */
export declare const ZCODE_MCP_SERVER_NAME = "dshbridge";
/**
 * One entry of the `session/create.mcpServers` array.
 *
 * Shape taken from the CLI's own strict schema (`Hhe` in `zcode.cjs`, union of
 * a stdio and an http/sse branch, both `.strict()`): the http branch requires
 * `name`, `type`, `url` and `headers`, and each header is `{name, value}`.
 * Optional knobs (`isolation`, `protocolVersion`, `alwaysLoad`, `timeoutMs`)
 * are deliberately left out — their semantics were not measured on this
 * machine, and an unmeasured knob is worse than the CLI default.
 */
export interface ZcodeMcpServerEntry {
    readonly name: string;
    readonly type: 'http';
    readonly url: string;
    readonly headers: ReadonlyArray<{
        readonly name: string;
        readonly value: string;
    }>;
}
export interface DshMcpBridge {
    /** The bridge is live: endpoint mounted and reachable at {@link url}. */
    readonly active: boolean;
    /** Why the bridge is not active, when it is not. */
    readonly inactiveReason: string | undefined;
    readonly endpoint: McpEndpoint | undefined;
    /** URL ZCode reaches the bridge on; undefined until the bridge is live. */
    readonly url: string | undefined;
    /** Point the bridge at the DSH session owning the next ZCode turn. */
    readonly setSession: (sessionId: string) => void;
    /**
     * The `mcpServers` entry to hand to `session/create`, or an empty array when
     * the bridge is not live. Recomputed per call so a late-bound port is picked
     * up instead of freezing the value read at plugin load.
     */
    readonly mcpServers: () => readonly ZcodeMcpServerEntry[];
    readonly dispose: () => Promise<void>;
}
/**
 * Bring the bridge up. Every failure mode resolves to `active: false` with a
 * reason instead of throwing, so the provider can fall back to the prompt
 * contract path when the carrier or the tool registry is not available.
 */
export declare function startDshMcpBridge(options: DshMcpBridgeOptions): Promise<DshMcpBridge>;
//# sourceMappingURL=bridge.d.ts.map