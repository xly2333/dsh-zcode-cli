/**
 * Minimal MCP (Model Context Protocol) server-side JSON-RPC layer.
 *
 * DSH ships `@modelcontextprotocol/core`, but that package exports only Zod
 * schemas — it has no `Server` class and no transport. The framing and the
 * three methods a client actually needs are implemented here, deliberately
 * small: a session-based server (one session per client conversation) over
 * newline delimited JSON-RPC 2.0.
 *
 * Wire behaviour, as measured on this machine against ZCode's MCP client (the
 * A3 probe run, see `docs/dsh-provider-contract.md`). These are the rules the
 * server holds to, not preferences:
 * - the negotiated protocol version is echoed back from the client: a client
 *   that asks for one of `MCP_SUPPORTED_PROTOCOL_VERSIONS` must not be answered
 *   with a version it did not offer;
 * - a JSON-RPC *notification* (no `id`) must never be answered;
 * - tool failures travel as a normal `tools/call` result with `isError: true`
 *   so the model can react to them instead of seeing a transport error.
 */
export declare const MCP_PROTOCOL_VERSION = "2025-06-18";
export declare const MCP_SUPPORTED_PROTOCOL_VERSIONS: readonly ["2025-06-18", "2025-03-26", "2024-11-05"];
export declare const MCP_ERROR_CODES: Readonly<{
    parseError: -32700;
    invalidRequest: -32600;
    methodNotFound: -32601;
    invalidParams: -32602;
    internalError: -32603;
}>;
export interface McpTextContent {
    readonly type: 'text';
    readonly text: string;
}
export interface McpToolDescriptor {
    readonly name: string;
    readonly description: string;
    /** JSON Schema for the tool arguments; already sanitized by the caller. */
    readonly inputSchema: Record<string, unknown>;
}
export interface McpCallResult {
    readonly content: readonly McpTextContent[];
    readonly isError: boolean;
}
export interface McpJsonRpcError {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
}
export interface McpJsonRpcResponse {
    readonly jsonrpc: '2.0';
    /** `null` when the request had no recoverable id (JSON-RPC 2.0 spec). */
    readonly id: string | number | null;
    readonly result?: unknown;
    readonly error?: McpJsonRpcError;
}
export interface McpInitializeResult {
    readonly protocolVersion: string;
    readonly capabilities: Record<string, unknown>;
    readonly serverInfo: {
        readonly name: string;
        readonly version: string;
    };
    readonly instructions: string;
}
export interface McpServerHandlers {
    readonly serverName: string;
    readonly serverVersion: string;
    readonly instructions: string;
    /** Tools exposed for one session; re-read on every `tools/list`. */
    listTools(sessionId: string): Promise<readonly McpToolDescriptor[]>;
    /** Execute one tool call for a session. Rejections become `isError` results. */
    callTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}
/** Pick the highest protocol version both sides understand. */
export declare function negotiateProtocolVersion(requested: unknown): string;
/**
 * One MCP server instance. It is transport agnostic: `handleMessage` takes one
 * decoded JSON-RPC message and returns the response to write back, or
 * `undefined` for notifications.
 */
export declare class McpServerSession {
    private readonly handlers;
    private initialized;
    private clientInfo;
    private sessionHandle;
    constructor(handlers: McpServerHandlers);
    get isInitialized(): boolean;
    get client(): {
        name?: string;
        version?: string;
    } | undefined;
    handleMessage(raw: string, sessionHandle?: string): Promise<McpJsonRpcResponse | undefined>;
    private dispatch;
    private initialize;
    private callTool;
    /**
     * Resolve which ZCode conversation a request belongs to. The transport-level
     * handle (the secret path segment) wins, because it is what the endpoint
     * minted for this bridge; `_meta.sessionId` is the client's own hint and is
     * used only when the transport supplies nothing.
     */
    private resolveSession;
}
export declare class McpRpcError extends Error {
    readonly code: number;
    readonly data: unknown;
    constructor(code: number, message: string, data?: unknown);
}
/** Serialize one response as a single newline-terminated JSON-RPC frame. */
export declare function encodeMcpFrame(response: McpJsonRpcResponse): string;
//# sourceMappingURL=protocol.d.ts.map