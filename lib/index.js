/**
 * Bundle entry of the ZCode provider.
 *
 * This file is the whole registration surface — it owns the route name, the
 * settings namespace, and the adapter hand-off, and nothing else. Everything
 * that touches a process, a session or a stream lives behind it, so a host that
 * cannot load the adapter still gets a readable directory entry instead of a
 * half-mounted plugin.
 */
import { existsSync, appendFileSync } from 'node:fs';
import { BundleConfig, configBoolean, configFlag } from './provider/config.js';
import { createZcodeWebRoutes } from './web/router.js';
import { SelectionStore } from './selection.js';


/**
 * Version reported to ZCode in the MCP `serverInfo` handshake.
 *
 * Kept beside the code instead of read from `package.json`: the entry point is
 * loaded during host boot and a filesystem read there is one more way for the
 * provider to fail. Bumped with `package.json` — a functional merge bumps the
 * minor, a fix keeps the number.
 */
// 附件解析排障日志(2026-11-18):resolveAttachmentHostPath 每次解析结果落一行,
// 供图片通道排障([img] via=… path=…)。挂载诊断脚手架已在根因确认后移除。
const REG_LOG = 'C:/Users/Administrator/.zcode-bridge/zcli-register.log';
const ZCODE_SERVER_VERSION = '0.3.1';
/** Disposers for the routes this bundle mounted; drained on dispose. */
const webServerDisposers = [];
/**
 * The live selection store, if `apply` has run.
 *
 * The adapter reads the same store the card writes, so switching plan, model
 * or effort takes effect on the next turn instead of needing a host restart.
 */
let selectionStoreRef;
/** The selection store mounted by this bundle, for the adapter and diagnostics. */
export function getSelectionStore() {
    return selectionStoreRef;
}
/** The host web server this bundle mounted onto, captured for the probe route. */
let mountedWebServer;
function webServerRef() {
    return mountedWebServer;
}
/** Describe an unknown thrown value without leaking secrets. */
function probeError(error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
/**
 * Answer, from inside the host process, the two questions a browser cannot:
 * does the LLM registry really resolve this provider's models (the picker drops
 * a group whose resolution throws), and did the browser half reach the client
 * module graph (the settings card is served from there).
 */
async function catalogProbe(ctx, webServer) {
    const report = {
        probeVersion: 'diag-1',
        webServerMounted: webServer !== undefined,
    };
    const llm = ctx.llm;
    if (llm === undefined) {
        report['llm'] = 'absent';
    }
    else {
        let providers = null;
        try {
            providers = llm.listProviders().map((provider) => ({ id: provider.id, name: provider.name }));
        }
        catch (error) {
            providers = probeError(error);
        }
        const perProvider = {};
        try {
            for (const provider of llm.listProviders()) {
                const row = {};
                try {
                    const models = await llm.listModels(provider.id);
                    row['models'] = models.map((model) => ({ id: model.id, name: model.name }));
                    const resolved = {};
                    for (const model of models) {
                        try {
                            resolved[model.id] = await llm.resolveModelInfo(provider.id, model.id);
                        }
                        catch (error) {
                            resolved[model.id] = `THREW ${probeError(error)}`;
                        }
                    }
                    row['resolved'] = resolved;
                }
                catch (error) {
                    row['error'] = probeError(error);
                }
                perProvider[provider.id] = row;
            }
        }
        catch (error) {
            perProvider['enumerate'] = probeError(error);
        }
        report['llm'] = { providers, perProvider };
    }
    const clientModules = ctx.get?.('clientModules');
    if (clientModules === undefined || clientModules === null) {
        report['clientModules'] = 'absent';
    }
    else {
        const shape = { ownKeys: Object.keys(clientModules) };
        const graph = clientModules.graph;
        if (typeof graph === 'function') {
            try {
                const value = graph.call(clientModules);
                shape['graph'] = value === null || value === undefined
                    ? value
                    : { entries: value.entries };
            }
            catch (error) {
                shape['graph'] = `THREW ${probeError(error)}`;
            }
        }
        report['clientModules'] = shape;
    }
    return report;
}
/** Plugin identity; also the settings namespace the Models page keys on. */
export const name = 'dsh-zcode-cli';
/**
 * Services this plugin needs before `apply` runs.
 *
 * Only `llm` is declared: sibling-bundle services (sessions, tools, attachments,
 * webServer…) are read through `ctx.get()` inside apply, because cordis throws
 * on undeclared property access but tolerates `ctx.get` for anything, and a
 * declared-but-late service would block the mount instead of degrading it.
 */
export const inject = ['llm'];
/** Bundle default: enabled, with tools rejected. */
export const Config = BundleConfig;
/** The DSH provider route owned by this plugin. */
export const ZCODE_PROVIDER_ROUTE = 'zcode';
/** Settings namespace; MUST equal the package name, which is what the UI matches. */
export const ZCODE_SETTINGS_NS = 'dsh-zcode-cli';
/** Display name of the provider card on the Models page. */
export const ZCODE_DISPLAY_NAME = 'ZCode CLI';
/**
 * Module specifier of the adapter implementation, resolved at apply time.
 *
 * It is held in a variable on purpose: the adapter lands in a later batch of
 * this build (B4), and a static import of a file that does not exist yet would
 * make every intermediate `tsc` run fail. Loading it lazily keeps this entry
 * point independently buildable and independently testable.
 */
const ADAPTER_MODULE_SPECIFIER = './provider/zcode.js';
/**
 * Build the `cwd` resolver the adapter calls before every spawn.
 *
 * The host knows the workspace, the adapter does not: `GenerateOptions` carries
 * no path, so the entry resolves session → `header.cwd` → `workspaceRegistry`
 * once per turn and hands the root down. Any missing link returns `undefined`,
 * which the adapter turns into `WORKSPACE_UNAVAILABLE`; it must never fall back
 * to `process.cwd()` (the DSH install directory, not the user's project).
 */
export function createWorkspaceRootResolver(ctx) {
    const services = ctx;
    return async (conversationId) => {
        if (conversationId === undefined)
            return undefined;
        // inject 只声明 llm；其余服务一律用 ctx.get 读取（对缺失服务返回 undefined，
        // 属性访问 ctx.sessions 在未声明 inject 时会直接抛错）。
        const sessions = services.get?.('sessions');
        const cwd = sessions?.get?.(conversationId)?.header?.cwd;
        if (typeof cwd !== 'string' || cwd.trim().length === 0)
            return undefined;
        const registry = services.get?.('workspaceRegistry');
        if (registry?.resolveByPath === undefined)
            return undefined;
        const workspace = await registry.resolveByPath(cwd);
        if (workspace === undefined)
            return undefined;
        if (typeof workspace.status === 'function' && await workspace.status() !== 'ok')
            return undefined;
        return typeof workspace.path === 'string' && workspace.path.trim().length > 0 ? workspace.path : cwd;
    };
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
export async function apply(ctx, config) {
    const logger = ctx.logger(ZCODE_SETTINGS_NS);
    // 环境自举(2026-11-17 固化):契约变量、CLI 专用配置派生、桌面管道动态发现。
    // 必须最先执行——适配器与凭据读取都依赖这些值。全部幂等,已有值不覆盖。
    try {
        const { bootstrapEnvironment } = await import('./bootstrap-env.js');
        bootstrapEnvironment((message) => logger.info('zcode: %s', message));
    }
    catch (error) {
        logger.warn('zcode: environment bootstrap failed: %s', describe(error));
    }
    // Settings panel: the local ZCode CLI appears as the `zcode` provider. The
    // namespace is the plugin name; settingsPath [] means the whole section is
    // the profile.
    try {
        ctx.llm.registerConfigurableProviders([{
                provider: ZCODE_PROVIDER_ROUTE,
                displayName: ZCODE_DISPLAY_NAME,
                settingsNs: ZCODE_SETTINGS_NS,
                settingsPath: [],
            }]);
    }
    catch (error) {
        // A duplicate directory entry means this profile mounts the plugin twice;
        // the first mount already owns the row, so the route stays usable.
        logger.warn('zcode: configurable provider registration refused: %s', describe(error));
    }
    // Settings card: the card reads its state (plan, model, effort) over a
    // loopback route and writes the selection back over the same route. The
    // selection lives in the plugin's own file store — never in ZCode's
    // `provider_config.json`, which belongs to another application and carries
    // its API key.
    //
    // Mounted before the `enabled` check on purpose: the card stays readable and
    // the selection stays switchable even when the adapter is off. A host without
    // a web server simply never runs the registration callback, and any failure
    // here costs the panel, never the provider row registered above.
    const selectionStore = new SelectionStore({
        onRecovery: (reason) => { logger.warn('zcode: selection recovered: %s', reason); },
    });
    selectionStoreRef = selectionStore;
    try {
        await selectionStore.prime();
    }
    catch (error) {
        // `prime` already swallows the expected failures; this is belt and braces
        // so a surprise never takes the provider row down with it.
        logger.warn('zcode: selection not primed: %s', describe(error));
    }
    // The MCP tool bridge hands the host's own tools to ZCode out of band (their
    // schemas never enter the prompt) and routes every execution back through the
    // host's tool pipeline. It is started from the webServer readiness callback
    // because the carrier has to exist first, and it is kept behind a dynamic
    // import so a bridge that fails to load can never stop the provider from
    // registering.
    let toolBridge;
    let toolBridgeStarting = false;
    const wantsBridge = configFlag(config.mcpBridge, true)
        && (config.toolPolicy ?? 'dsh-owned') === 'dsh-owned';
    const startToolBridge = (webServer) => {
        if (!wantsBridge || toolBridgeStarting)
            return;
        toolBridgeStarting = true;
        void (async () => {
            try {
                const bridgeModule = await import('./mcp/bridge.js');
                const bridge = await bridgeModule.startDshMcpBridge({
                    webServer,
                    // Read through `ctx.get` instead of property access: the tool service
                    // is mounted by another bundle and Cordis wants declared injections
                    // for property reads. A miss here is reported by the bridge itself.
                    tools: ctx.get('tools'),
                    sessionControllerLookup: () => ctx.get('sessionController'),
                    serverVersion: ZCODE_SERVER_VERSION,
                    logger: (message) => logger.info(message),
                });
                toolBridge = bridge;
                if (!bridge.active) {
                    logger.warn('zcode: MCP tool bridge inactive: %s', bridge.inactiveReason ?? 'unknown reason');
                }
                else {
                    logger.info('zcode: MCP tool bridge live at %s', bridge.url ?? '<pending port>');
                }
            }
            catch (error) {
                // Never throw: the provider must keep working with the CLI's built-ins.
                logger.warn('zcode: MCP tool bridge failed to start: %s', describe(error));
            }
        })();
    };
    try {
        const routes = createZcodeWebRoutes({
            getConfig: () => selectionStore.get(),
            setSelection: async (patch) => { await selectionStore.write(patch); },
            probe: async () => catalogProbe(ctx, webServerRef()),
        });
        ctx.inject(['webServer'], (innerCtx) => {
            const webServer = innerCtx.webServer;
            if (webServer === undefined || typeof webServer.register !== 'function')
                return;
            mountedWebServer = webServer;
            startToolBridge(webServer);
            try {
                webServerDisposers.push(routes.register(webServer));
            }
            catch (error) {
                logger.warn('zcode: settings routes refused: %s', describe(error));
            }
        });
    }
    catch (error) {
        logger.warn('zcode: settings endpoint not mounted: %s', describe(error));
    }
    // No `registerModelDiscovery`: ZCode 0.17.0 has no quota-free model listing,
    // so the catalog is static and discovery would have to spend a real turn.
    // `enabled` is `.volatile()`, so the host hands `apply` a reference object
    // (`{ get() }`), not a primitive: `config.enabled !== true` was therefore
    // always true and the adapter was never registered. `configBoolean` accepts
    // both the primitive (programmatic config, tests) and the reference.
    // 2026-11-17 修复:patch 合并会把 enabled 擦成空对象(volatile 引用丢失),
    // configBoolean({}) 返回 false → 适配器被误判禁用(NO_ADAPTER)。
    // 语义收紧:只有显式 false 才禁用;缺省/对象一律视为启用。
    const enabledExplicit = config.enabled === false
        ? false
        : (typeof config.enabled === 'boolean' ? config.enabled : true);
    if (!enabledExplicit) {
        logger.warn('zcode: adapter disabled, config.enabled=%s (raw=%s)', String(config.enabled), JSON.stringify(config?.enabled));
        return;
    }
    logger.info('zcode: adapter enabled, registering on route %s', ZCODE_PROVIDER_ROUTE);
    let module;
    try {
        module = await import(ADAPTER_MODULE_SPECIFIER);
    }
    catch (error) {
        // Deliberately not thrown: this runs during host boot, and an unloadable
        // adapter must not take the whole profile down. The failure is logged with
        // the module specifier so it is actionable rather than silent.
        logger.error('zcode: cannot load adapter module %s (%s); provider route not registered', ADAPTER_MODULE_SPECIFIER, describe(error));
        return;
    }
    if (typeof module.ZcodeAdapter !== 'function') {
        logger.error('zcode: adapter module %s does not export a ZcodeAdapter class; provider route not registered', ADAPTER_MODULE_SPECIFIER);
        return;
    }
    const adapter = new module.ZcodeAdapter(config, {
        logger: (record) => {
            try {
                logger.info('%s', JSON.stringify(record));
            }
            catch (error) {
                logger.warn('zcode: diagnostic record was not serializable: %s', describe(error));
            }
        },
        resolveWorkspaceRoot: createWorkspaceRootResolver(ctx),
        // 图片输入通道(2026-11-18):把 DSH 附件引用解析成宿主绝对路径,适配器把它
        // 作为 CLI 原生形状 {kind:'image', filename, mimeType, localPath} 随
        // session/send 传给 CLI(桌面端原生能力)。
        // ctx.get 无 inject 要求,附件服务缺失时返回 undefined → 占位文本兜底。
        resolveAttachmentHostPath: (ref) => {
            // 2026-11-18 修复:图片附件(saveImages 压缩管线)存于 objects/ 树,必须用
            // imageHostPath(normalizedImagePath);fileHostPath 走 files/ 树且校验
            // 文件引用形状,对图片引用必抛 INVALID_ATTACHMENT_REF——此前所有图片
            // 都掉进占位文本分支,模型只看到 sha256 引用看不到图。文件附件仍走
            // fileHostPath 兜底;结果落 REG_LOG 便于排障。
            let resolved;
            let via = 'none';
            try {
                const store = ctx.get('attachments') ?? ctx.get('attachment');
                const p = store?.imageHostPath?.(ref);
                if (typeof p === 'string' && p.length > 0) {
                    resolved = p;
                    via = 'imageHostPath';
                }
            }
            catch {
                /* 图片引用校验失败 → 试文件通道 */
            }
            if (resolved === undefined) {
                try {
                    const p = ctx.get('attachments')?.fileHostPath?.(ref);
                    if (typeof p === 'string' && p.length > 0) {
                        resolved = p;
                        via = 'fileHostPath';
                    }
                }
                catch {
                    /* 文件引用也不合法 → 占位文本兜底 */
                }
            }
            try {
                appendFileSync(REG_LOG, `${new Date().toISOString()} [img] id=${ref?.attachmentId} via=${via} path=${resolved ?? 'UNRESOLVED'}\n`, 'utf8');
            }
            catch {
                /* 诊断日志失败不影响主流程 */
            }
            return resolved;
        },
        // Re-read on every call: the card writes the store between turns, so a
        // one-shot read here would freeze whatever was selected at boot.
        // Still gated on the file existing: the store hands out its defaults for a
        // missing file, and those defaults name `free` — handing them over would
        // move a profile that deliberately runs `paid` onto an unverified plan the
        // moment it boots.
        getSelection: () => {
            try {
                return existsSync(selectionStore.filePath) ? selectionStore.get() : undefined;
            }
            catch (error) {
                logger.warn('zcode: selection not readable: %s', describe(error));
                return undefined;
            }
        },
        // Resolved per turn: the bridge starts asynchronously after this point, so
        // a captured value would stay undefined for the life of the host.
        resolveMcpBridge: () => {
            if (!wantsBridge)
                return undefined;
            return toolBridge?.active === true ? toolBridge : undefined;
        },
    });
    ctx.llm.registerAdapter([ZCODE_PROVIDER_ROUTE], adapter);
    logger.info('zcode: adapter registered on route %s', ZCODE_PROVIDER_ROUTE);
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=index.js.map