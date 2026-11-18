import type { McpToolDescriptor } from './protocol.js';
/** The subset of `ctx.tools` this module needs. */
export interface DshToolRegistryLike {
    schemas(scope?: unknown): readonly unknown[];
}
export interface DshToolSchemaLike {
    readonly name?: unknown;
    readonly description?: unknown;
    readonly parameters?: unknown;
}
export interface ToolProjectionOptions {
    /** Restrict the projection to these tool names (empty/absent = every tool). */
    readonly allowlist?: readonly string[];
    /** Upper bound on projected tools; guards a pathological registry. */
    readonly maxTools?: number;
    /**
     * The viewing scope, i.e. the live agent of the DSH session the bridge serves.
     * This is load-bearing: `ctx.tools.schemas()` with no scope answers with the
     * GLOBAL view, and `read`/`write`/`grep`/`pwsh` are no longer in the global
     * layer — the official presets moved them onto the agent plane, so they reach
     * a scope only as ancestor contributions. A scope-less projection therefore
     * hands ZCode the UI/memory tools and silently drops every file and shell tool.
     */
    readonly scope?: unknown;
}
export interface ToolProjectionResult {
    readonly tools: readonly McpToolDescriptor[];
    /**
     * Names dropped by the allowlist, the built-in exclusions, or the cap. The
     * caller cannot tell those three apart from this list alone, which is why the
     * bridge filters the built-ins out before it reports what the model is
     * missing: a cap overflow has to be visible in the log, and for two rounds it
     * was not.
     */
    readonly excluded: readonly string[];
}
/**
 * Tools that must never be projected to ZCode. These are either DSH-internal
 * controls that would let ZCode steer its own host, or tools whose execution
 * requires a DSH agent identity that an MCP-originated call does not carry.
 *
 * Exported so the bridge can tell "dropped on purpose" apart from "dropped by
 * the cap" when it reports what the model is missing.
 */
export declare const NEVER_PROJECTED_TOOLS: ReadonlySet<string>;
/**
 * Project the registry. `listChanged: false` is advertised to ZCode, so the set
 * is snapshotted per request rather than pushed; a profile change simply takes
 * effect on the next turn.
 */
/**
 * Check a call's arguments against the projected schema, mechanically.
 *
 * ZCode does not honour `required` and sometimes sends the wrong primitive
 * (`{"query":123}` for a string field, `{}` for a call that needs one). Left
 * unchecked, every such call still walks the host guard chain and the approval
 * service before the schema layer rejects it — so the bridge answers first, with
 * the same wording the host uses. Anything this function cannot decide
 * (unknown property, no declared type) is left to DSH: a bridge that guesses
 * would be a second, weaker validator pretending to be the real one.
 */
export declare function validateToolArguments(schema: unknown, args: unknown): string[];
export declare function projectDshTools(registry: DshToolRegistryLike | undefined, options?: ToolProjectionOptions): ToolProjectionResult;
//# sourceMappingURL=tool-projection.d.ts.map