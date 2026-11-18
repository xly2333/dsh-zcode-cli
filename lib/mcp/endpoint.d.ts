import type { IncomingMessage, ServerResponse } from 'node:http';
import { type McpCallResult, type McpToolDescriptor } from './protocol.js';
/** The host's HTTP carrier service (`ctx.webServer`). */
export interface DshWebServerLike {
    /** The listening port; `undefined` before the carrier finishes listening. */
    readonly port?: number;
    readonly host?: string;
    register(route: DshWebRoute): () => void;
}
export interface DshWebRoute {
    readonly kind: 'exact' | 'prefix';
    readonly path: string;
    readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export interface McpEndpointOptions {
    readonly serverName: string;
    readonly serverVersion: string;
    readonly instructions: string;
    readonly listTools: (sessionId: string) => Promise<readonly McpToolDescriptor[]>;
    readonly callTool: (sessionId: string, name: string, args: Record<string, unknown>) => Promise<McpCallResult>;
    readonly logger?: (message: string) => void;
}
export interface McpEndpoint {
    /** Full loopback URL including the secret path segment, or undefined if the
     *  carrier has not reported a port yet. */
    readonly url: string | undefined;
    /** Bearer token ZCode must send. */
    readonly token: string;
    /** Point the endpoint at the DSH session the next ZCode turn belongs to. */
    readonly setSession: (sessionId: string) => void;
    readonly dispose: () => void;
}
/** Loopback-only, shared with the settings panel routes. */
export declare function isLoopback(address: string | undefined): boolean;
/**
 * Claim one MCP route on the host carrier. The returned `dispose` releases the
 * route; callers must invoke it from an effect so a plugin reload cannot leak
 * the registration.
 */
export declare function mountMcpEndpoint(webServer: DshWebServerLike, options: McpEndpointOptions): McpEndpoint;
//# sourceMappingURL=endpoint.d.ts.map