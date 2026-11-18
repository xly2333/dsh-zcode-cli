/**
 * The runtime half of the MCP bridge.
 *
 * There is no config-file side: ZCode takes its MCP servers as a
 * `session/create` parameter, so the whole registration is the descriptor this
 * module hands to the app-server (`mcpServers()`), and nothing is written to
 * another application's disk.
 *
 * This module owns the live half: the projected tool set, the loopback HTTP
 * endpoint on the host's `webServer` carrier, and the `tools/call` round-trip
 * back into the DSH tool pipeline.
 *
 * One deliberate asymmetry: listing tools is dynamic (the DSH registry can
 * change between turns), while execution always goes through
 * `tools.execute()` so the host's guard chain and approval service see every
 * call. The call carries the owning session's live Agent, resolved through
 * `sessionController.resolveAgent()`, because the DSH approval service denies
 * any call that has no agent to route through.
 */
import { randomUUID } from 'node:crypto';
import { mountMcpEndpoint } from './endpoint.js';
import { projectDshTools, validateToolArguments, NEVER_PROJECTED_TOOLS, } from './tool-projection.js';
/** Server name ZCode sees, and the prefix of every projected tool name. */
export const ZCODE_MCP_SERVER_NAME = 'dshbridge';
const INSTRUCTIONS = [
    'These tools are executed by the DSH host, not by this environment.',
    'Call a tool by its name; the DSH host validates arguments, applies its own',
    'permission policy, and returns the result. A result with isError=true means',
    'the host refused or failed the call — report it instead of retrying blindly.',
].join(' ');
function textOf(block) {
    if (typeof block !== 'object' || block === null)
        return undefined;
    const record = block;
    if (record.type !== 'text' || typeof record.text !== 'string')
        return undefined;
    return record.text;
}
function resultToCallResult(result) {
    if (result.isError) {
        const message = typeof result.error?.message === 'string' ? result.error.message : 'tool execution failed';
        const detail = Array.isArray(result.content)
            ? result.content.map(textOf).filter((part) => part !== undefined).join('\n')
            : '';
        return { content: [{ type: 'text', text: detail.length > 0 ? `${message}\n${detail}` : message }], isError: true };
    }
    const blocks = [];
    if (Array.isArray(result.content)) {
        for (const block of result.content) {
            const text = textOf(block);
            blocks.push({ type: 'text', text: text ?? JSON.stringify(block) });
        }
    }
    if (blocks.length === 0) {
        blocks.push({ type: 'text', text: result.value === undefined ? '' : JSON.stringify(result.value) });
    }
    return { content: blocks, isError: false };
}
/**
 * Bring the bridge up. Every failure mode resolves to `active: false` with a
 * reason instead of throwing, so the provider can fall back to the prompt
 * contract path when the carrier or the tool registry is not available.
 */
export async function startDshMcpBridge(options) {
    const inactive = (reason) => {
        options.logger?.(`dsh mcp bridge inactive: ${reason}`);
        return {
            active: false,
            inactiveReason: reason,
            endpoint: undefined,
            url: undefined,
            setSession: () => { },
            mcpServers: () => [],
            dispose: async () => { },
        };
    };
    if (options.webServer === undefined || typeof options.webServer.register !== 'function') {
        return inactive('host webServer service is unavailable');
    }
    if (typeof options.tools?.schemas !== 'function' || typeof options.tools?.execute !== 'function') {
        return inactive('host tools service is unavailable');
    }
    let endpoint;
    try {
        // Project lazily on every `tools/list`: the bridge starts during plugin
        // load, but the file, shell, and web tools only join `ctx.tools` once the
        // agent presets and the remaining services finish mounting. Snapshotting
        // here froze a host that had 18 tools and never exposed the rest.
        if (projectDshTools(options.tools, {
            ...(options.toolAllowlist === undefined ? {} : { allowlist: options.toolAllowlist }),
        }).tools.length === 0) {
            return inactive('host tools service exposed no tools');
        }
        endpoint = mountMcpEndpoint(options.webServer, {
            serverName: ZCODE_MCP_SERVER_NAME,
            serverVersion: options.serverVersion,
            instructions: INSTRUCTIONS,
            listTools: async (sessionHandle) => {
                const agent = await agentOf(options, sessionHandle);
                const projection = projectVisibleTools(options, agent);
                const dropped = projection.excluded.filter(name => !NEVER_PROJECTED_TOOLS.has(name));
                options.logger?.(`dsh mcp bridge: listTools session="${sessionHandle}" agent=${agent === undefined ? 'none' : 'resolved'} tools=${projection.tools.length}${dropped.length === 0 ? '' : ` dropped=${dropped.join(',')}`}`);
                return projection.tools;
            },
            callTool: (sessionHandle, name, args) => executeDshTool(options, sessionHandle, name, args),
            ...(options.logger === undefined ? {} : { logger: options.logger }),
        });
    }
    catch (error) {
        return inactive(`endpoint mount failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (endpoint.url === undefined) {
        endpoint.dispose();
        return inactive('host webServer has not reported a listening port');
    }
    // No registration step: the descriptor travels with `session/create`, so
    // there is no second application's config file to keep in sync and nothing
    // to unwind on dispose. `url` is read from the live endpoint each time so a
    // port that appears after plugin load is still picked up.
    return {
        active: true,
        inactiveReason: undefined,
        endpoint,
        url: endpoint.url,
        setSession: handle => endpoint.setSession(handle),
        mcpServers: () => {
            const url = endpoint.url;
            if (url === undefined)
                return [];
            return [{
                    name: ZCODE_MCP_SERVER_NAME,
                    type: 'http',
                    url,
                    headers: [{ name: 'Authorization', value: `Bearer ${endpoint.token}` }],
                }];
        },
        dispose: async () => {
            endpoint.dispose();
        },
    };
}
/**
 * Resolve the live Agent for the session this bridge currently serves.
 *
 * The adapter re-points the endpoint at the DSH session before every ZCode turn
 * (see the `setSession` call in the provider), and that handle survives across
 * turns, so a direct lookup is enough. Getting the Agent matters twice over: the
 * approval service denies any execution with no agent to route through, and the
 * tool registry answers a *scoped* query with the agent-plane tools (file and
 * shell) that its global view does not contain.
 *
 * A failure to resolve is reported through the bridge logger instead of being
 * swallowed: "the session has no agent" and "the lookup threw" look identical
 * from the outside, and that ambiguity is what made this bug cost a restart.
 */
async function agentOf(options, sessionHandle) {
    // The lookup reads a Cordis service that a sibling bundle mounts later;
    // cordis throws on property access while it is not mounted. Degrade to the
    // static controller instead of failing every MCP request with a 500.
    let controller;
    try {
        controller = options.sessionControllerLookup?.();
    }
    catch {
        controller = undefined;
    }
    controller ??= options.sessionController;
    if (controller === undefined) {
        options.logger?.('dsh mcp bridge: the host sessionController service is unavailable');
        return undefined;
    }
    if (sessionHandle.length === 0)
        return undefined;
    const resolved = await controller.resolveAgent(sessionHandle).catch((error) => {
        const rejection = subagentRejectionIn(error);
        options.logger?.(rejection === undefined
            ? `dsh mcp bridge: resolveAgent("${sessionHandle}") threw ${String(error)}`
            : `dsh mcp bridge: session "${sessionHandle}" is owned by subagent routing (${rejection}); the host refuses an agent handle for a child session by design, so this turn sees the global tool view`);
        return undefined;
    });
    const agent = agentIn(resolved);
    if (agent === undefined) {
        options.logger?.(`dsh mcp bridge: no agent resolved for session "${sessionHandle}"`);
    }
    return agent;
}
/**
 * Read the host's subagent-ownership rejection out of a thrown value.
 *
 * `sessionController.resolveAgent()` answers `RemoteError('session/agent-busy')`
 * with `reason: 'use subagent delivery for this child session'` for any session
 * whose header carries `origin: 'subagent'` — the host deliberately refuses to
 * hand out an agent handle for a child session. That is a designed boundary, not
 * a bridge defect, so the log says so instead of leaving a bare
 * "no agent resolved" line that reads like a bug every time a subagent runs.
 */
function subagentRejectionIn(error) {
    if (typeof error !== 'object' || error === null)
        return undefined;
    const record = error;
    const details = typeof record.details === 'object' && record.details !== null
        ? record.details
        : undefined;
    const reason = typeof details?.reason === 'string' ? details.reason : undefined;
    if (reason !== undefined && /subagent delivery/i.test(reason))
        return reason;
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    if (code === 'session/agent-busy' || (message !== undefined && /subagent routing/i.test(message))) {
        return message ?? code ?? 'session/agent-busy';
    }
    return undefined;
}
function agentIn(resolved) {
    if (resolved === undefined || resolved === null)
        return undefined;
    // The host's controller already unwraps: `sessionController.resolveAgent()`
    // returns the Agent itself (it throws `ApiSessionAgentResult.error` instead of
    // handing back a wrapper). Older and mocked shapes carry `{ agent }`, so accept
    // both — but never mistake a thrown-error wrapper for a live agent.
    if (typeof resolved === 'object') {
        const record = resolved;
        if ('agent' in record)
            return record.agent;
        // A rejection wrapper is not an agent; the host normally throws instead of
        // returning one, but an older build may hand it back as a value.
        if ('error' in record)
            return undefined;
    }
    return resolved;
}
async function executeDshTool(options, sessionHandle, name, args) {
    // Bridge-level gates first, independent of agent resolution: a tool the
    // projection layer refuses to show must never execute through this bridge.
    // Without this, a session whose agent could not be resolved (subagent
    // routing, controller not mounted) degenerates to the global view, and a
    // never-projected or allowlisted-out name would reach `tools.execute`
    // directly — bypassing the promise tool-projection.ts makes.
    if (NEVER_PROJECTED_TOOLS.has(name)) {
        return { content: [{ type: 'text', text: `unknown tool "${name}"` }], isError: true };
    }
    if (options.toolAllowlist !== undefined && options.toolAllowlist.length > 0
        && !options.toolAllowlist.includes(name)) {
        return { content: [{ type: 'text', text: `unknown tool "${name}"` }], isError: true };
    }
    // No resolvable agent means fail closed, never silently open: the call still
    // goes through `tools.execute()` so the host guard chain sees it, but the host
    // itself decides what an unscoped call may do.
    const agent = await agentOf(options, sessionHandle);
    const projected = projectVisibleTools(options, agent).tools;
    const descriptor = projected.find(entry => entry.name === name);
    if (descriptor === undefined) {
        // Only assert "unknown tool" when the projection is the one ZCode was shown.
        // With no resolvable agent the scoped list degenerates to the global view,
        // so a legitimate file tool can be missing from it; that call still has to
        // reach the host, which denies it on its own terms instead of us inventing a
        // rejection for a tool we merely failed to see.
        if (agent !== undefined) {
            return { content: [{ type: 'text', text: `unknown tool "${name}"` }], isError: true };
        }
    }
    else {
        const problems = validateToolArguments(descriptor.inputSchema, args);
        if (problems.length > 0) {
            // Wording mirrors the host's own rejection so ZCode sees one consistent
            // failure shape whether the bridge or DSH catches the call.
            return { content: [{ type: 'text', text: `invalid arguments: ${problems.join('; ')}` }], isError: true };
        }
    }
    const controller = new AbortController();
    const result = await options.tools.execute({
        callId: randomUUID(),
        name,
        arguments: args,
        ...(agent === undefined ? {} : { agent }),
        signal: controller.signal,
    });
    return resultToCallResult(result);
}
/**
 * The same projection `tools/list` advertises, used to pre-check a call.
 * A registry failure yields an empty list, which reads as "unknown tool" —
 * the correct fail-closed direction for a bridge that cannot see what it runs.
 */
function projectVisibleTools(options, agent) {
    return projectDshTools(options.tools, {
        ...(options.toolAllowlist === undefined ? {} : { allowlist: options.toolAllowlist }),
        scope: agent,
    });
}
//# sourceMappingURL=bridge.js.map