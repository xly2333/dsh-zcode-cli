/**
 * Bundle entry of the ZCode provider.
 *
 * This file is the whole registration surface — it owns the route name, the
 * settings namespace, and the adapter hand-off, and nothing else. Everything
 * that touches a process, a session or a stream lives behind it, so a host that
 * cannot load the adapter still gets a readable directory entry instead of a
 * half-mounted plugin.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { type Config as ConfigType } from './provider/config.js';
import { SelectionStore } from './selection.js';
/** The selection store mounted by this bundle, for the adapter and diagnostics. */
export declare function getSelectionStore(): SelectionStore | undefined;
/** Plugin identity; also the settings namespace the Models page keys on. */
export declare const name = "dsh-zcode-cli";
/**
 * Services this plugin needs before `apply` runs.
 *
 * Only `llm` is declared: sibling-bundle services are read through `ctx.get()`
 * inside apply, because cordis throws on undeclared property access but
 * tolerates `ctx.get` for anything, and a declared-but-late service would
 * block the mount instead of degrading it.
 */
export declare const inject: string[];
/** Bundle default: enabled, with tools rejected. */
export declare const Config: import("@deepseek-ai/schemastery").default<ConfigType>;
/** The DSH provider route owned by this plugin. */
export declare const ZCODE_PROVIDER_ROUTE = "zcode";
/** Settings namespace; MUST equal the package name, which is what the UI matches. */
export declare const ZCODE_SETTINGS_NS = "dsh-zcode-cli";
/** Display name of the provider card on the Models page. */
export declare const ZCODE_DISPLAY_NAME = "ZCode CLI";
/** Diagnostic sink handed to the adapter; one JSON line per record. */
export interface ZcodeAdapterDeps {
    readonly logger: (record: unknown) => void;
    /** Resolve the session workspace root; see {@link createWorkspaceRootResolver}. */
    readonly resolveWorkspaceRoot?: ((conversationId: string | undefined) => Promise<string | undefined>) | undefined;
    /**
     * Read the live selection this entry's store holds.
     *
     * Typed structurally here rather than imported from the adapter: this file is
     * the registration surface and loads the adapter dynamically, so a static
     * import of its types would make the two modules fail together.
     */
    readonly getSelection?: (() => {
        readonly plan?: string;
        readonly model?: string;
        readonly effort?: string;
    } | undefined) | undefined;
    /** Resolve the live MCP tool bridge; structural for the same reason as above. */
    readonly resolveMcpBridge?: (() => {
        readonly active: boolean;
        readonly mcpServers: () => readonly {
            readonly name: string;
            readonly type: 'http';
            readonly url: string;
            readonly headers: ReadonlyArray<{
                readonly name: string;
                readonly value: string;
            }>;
        }[];
        readonly setSession: (sessionId: string) => void;
    } | undefined) | undefined;
}
/**
 * Build the `cwd` resolver the adapter calls before every spawn.
 *
 * The host knows the workspace, the adapter does not: `GenerateOptions` carries
 * no path, so the entry resolves session → `header.cwd` → `workspaceRegistry`
 * once per turn and hands the root down. Any missing link returns `undefined`,
 * which the adapter turns into `WORKSPACE_UNAVAILABLE`; it must never fall back
 * to `process.cwd()` (the DSH install directory, not the user's project).
 */
export declare function createWorkspaceRootResolver(ctx: Context): (conversationId: string | undefined) => Promise<string | undefined>;
/**
 * Shape the adapter module must export.
 *
 * Frozen contract for B4: `src/provider/zcode.ts` exports a `ZcodeAdapter`
 * class whose constructor takes the resolved config and these deps, and which
 * implements `LlmAdapter`. The session registry and the durable session map are
 * constructed inside that module, not here — the two files that define them
 * belong to the same batch as the adapter.
 */
export interface ZcodeAdapterModule {
    readonly ZcodeAdapter: new (config: ConfigType, deps: ZcodeAdapterDeps) => LlmAdapter;
}
/**
 * Mount the provider.
 *
 * The directory entry is registered unconditionally and before anything can
 * fail: it is what makes the plugin visible (and its config editable) on the
 * Models page, and losing it on a transient adapter failure would leave the
 * page showing a provider row with no card. The adapter is registered only when
 * the bundle is explicitly enabled.
 */
export declare function apply(ctx: Context, config: ConfigType): Promise<void>;
//# sourceMappingURL=index.d.ts.map