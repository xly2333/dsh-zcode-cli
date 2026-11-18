import z from '@deepseek-ai/schemastery';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 通用路径探测：历史上这两个默认值硬编码了单台机器的安装位置，换机即死
 * （"ZCode executable not found"）。改为按探测链解析，全部未命中时保留旧值，
 * 让 spawn 处已有的存在性检查给出可读错误。
 */
function firstExisting(candidates) {
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 0 && existsSync(c))
            return c;
    }
    return null;
}

function resolveDefaultNodePath() {
    const execIsNode = /node(\.exe)?$/i.test(process.execPath);
    const execMajorOk = (() => {
        try {
            return Number(process.versions.node.split('.')[0]) >= 22; // node:sqlite floor
        }
        catch {
            return false;
        }
    })();
    const hit = firstExisting([
        process.env.ZCODE_NODE_PATH,
        execIsNode && execMajorOk ? process.execPath : null,
        'C:\\Program Files\\nodejs\\node.exe',
        'D:\\nodejs\\node.exe',
    ]);
    return hit ?? 'D:\\nodejs\\node.exe';
}

function resolveDefaultZcodeCjsPath() {
    const appDirs = [
        process.env.ZCODE_WINDOWS_APP_INSTALL_DIR,
        'F:\\app\\zcode',
        'C:\\app\\zcode',
        'D:\\app\\zcode',
        'F:\\AgentData\\zcode\\cli',
    ];
    const hit = firstExisting([
        process.env.ZCODE_CLI_ENTRY,
        ...appDirs.filter((d) => typeof d === 'string' && d.trim().length > 0).map((d) => join(d, 'resources', 'glm', 'zcode.cjs')),
    ]);
    return hit ?? 'F:\\AgentData\\zcode\\cli\\resources\\glm\\zcode.cjs';
}
/** Environment variable naming the ZCode *data* root (`<root>/.zcode/v2/...`). */
export const ZCODE_DATA_BASE_DIR_ENV = 'ZCODE_DATA_BASE_DIR';
// Keep the default route policy aligned with @deepseek-ai/dsh-llm.
// The DSH retry executor owns the retry loop; this list only declares which
// stable provider failures are eligible for that executor.
//
// QUOTA is deliberately absent: a 1309 ("plan expired") never clears on its
// own, so retrying it only multiplies the failures the user sees. AUTH is
// absent for the same reason — an invalid identity needs a new credential, not
// another process. ZCODE_EXIT stays eligible because a ZCode process that dies
// early (env not yet warm, transient spawn failure) genuinely succeeds on the
// next attempt.
export const ZCODE_RETRYABLE_CODES = [
    'RATE_LIMIT',
    'TIMEOUT',
    'ZCODE_EXIT',
    'ZCODE_UNKNOWN',
];
/** Static catalog verified against ZCode 0.17.0's configured providers. */
export const DEFAULT_MODELS = [
    // contextWindow 必须声明:DSH 的 compaction-basic 靠它计算容量,缺失会报
    // "no context capacity for zcode/<model>"。按用户要求用 400000(2026-11-18,
    // CLI 官方注册表标 200000,但 CLI wire 里 session/event 自报 contextWindow:400000)。
    // 免费套餐实测只能跑 GLM-5.3-Flash,GLM-5.3 不再进目录(选了会卡上游)。
    { id: 'GLM-5.3-Flash', name: 'GLM-5.3-Flash', contextWindow: 400000 },
];
/** Default model id handed to ZCode when a request does not override it. */
export const DEFAULT_MODEL = 'GLM-5.3-Flash';
/** Measured Node major floor: `node:sqlite` (used by ZCode 0.17.0) needs >= 22. */
export const DEFAULT_NODE_PATH = resolveDefaultNodePath();
/** Verified ZCode CLI entry script for 0.17.0. */
export const DEFAULT_ZCODE_CJS_PATH = resolveDefaultZcodeCjsPath();
const ModelConfigSchema = z.object({
    id: z.string().pattern(/^\S(?:.*\S)?$/).required(),
    name: z.string().pattern(/^\S(?:.*\S)?$/),
    // Kept for YAML/API compatibility; the selector intentionally does not render it.
    description: z.string().hidden(),
    contextWindow: z.natural().min(1).max(10_000_000),
});
const RetryPolicyConfig = z.object({
    maxRetries: z.natural().max(5).default(2),
    backoffMs: z.natural().min(0).max(60_000).default(1_000),
    // Deliberately open-ended: the allowlist must be able to grow without
    // rejecting every profile written against the previous list. Anything not in
    // ZCODE_RETRYABLE_CODES is dropped by the consumer.
    retryableCodes: z.array(z.string().pattern(/^[A-Z][A-Z0-9_]*$/)).min(1).default([...ZCODE_RETRYABLE_CODES]),
});
export function createConfigSchema(defaults = {}) {
    const defaultEnabled = defaults.enabled ?? false;
    const defaultToolPolicy = defaults.toolPolicy ?? 'dsh-owned';
    const schemaBase = z.object({
        enabled: z.boolean().default(defaultEnabled).description('Enable ZCode provider').volatile(),
        // The route is fixed by this plugin and is not a user-facing setting.
        provider: z.string().default('zcode').description('Provider route id').hidden(),
        model: z.string().default(DEFAULT_MODEL).description('Default model id'),
        // Explicit catalogs are an advanced YAML escape hatch; the UI uses the catalog.
        models: z.array(ModelConfigSchema).default([...DEFAULT_MODELS]).description('Explicit model catalog').hidden(),
        visibleModels: z.array(z.string().pattern(/^\S(?:.*\S)?$/)).default([]).description('Visible models filter; empty shows every catalog entry, non-empty only shows the listed ids'),
        // One-member union on purpose: no verified discovery command exists.
        modelDiscovery: z.union(['off']).default('off').description('Model discovery; off keeps the static catalog'),
        toolPolicy: z.union(['reject', 'zcode-owned', 'dsh-owned']).default(defaultToolPolicy).description('Tool ownership policy'),
        mcpBridge: z.boolean().default(true).description('Project the DSH tool registry to ZCode over MCP; only honoured when toolPolicy is dsh-owned'),
        toolAllowlist: z.array(z.string().pattern(/^\S(?:.*\S)?$/)).default([]).description('Tool names passed to session/create.toolAllowlist; empty sends no key').hidden(),
        toolDenylist: z.array(z.string().pattern(/^\S(?:.*\S)?$/)).default([]).description('Tool names passed to session/create.toolDenylist; empty sends no key').hidden(),
        mode: z.union(['guarded', 'yolo']).default('guarded').description('CLI permission mode (guarded denies CLI tool calls; yolo auto-approves every tool call)'),
        sessionMode: z.union(['resume', 'full']).default('full').description('Session mode: full replays history, resume reuses a ZCode session id'),
        sessionStorePath: z.string().default('').description('Durable sessionId to conversationId map path; empty uses DSH_HOME/zcode-provider/sessions.json'),
        passEnv: z.array(z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/)).default([]).description('Extra host environment variable names passed to the ZCode child; the allowlist is closed by default').hidden(),
        imageInput: z.union(['off', 'experimental']).default('off').description('Image input mode'),
        isolatedHome: z.boolean().default(true).description('Give the CLI child its own HOME seeded with the host global AGENTS.md, so user instructions arrive via the CLI-native trusted channel instead of pasted prompt text'),
        forwardSystemPrompt: z.boolean().default(false).description('Render the DSH system prompt into the CLI prompt; the CLI is a full agent with its own system prompt, so the default keeps the DSH preset (and anything it pulls in) out of every turn'),
        nodePath: z.string().pattern(/^\S(?:.*\S)?$/).default(DEFAULT_NODE_PATH).description('Node executable that runs the CLI; ZCode 0.17.0 needs node:sqlite, i.e. Node >= 22').hidden(),
        zcodeCjsPath: z.string().pattern(/^\S(?:.*\S)?$/).default(DEFAULT_ZCODE_CJS_PATH).description('ZCode CLI entry script (resources/glm/zcode.cjs)').hidden(),
        timeoutMs: z.number().min(1).max(3_600_000).default(900_000).description('Backstop wall clock per request ms; only an endless-output run can reach it').hidden(),
        idleTimeoutMs: z.number().min(1).max(3_600_000).default(300_000).description('Inactivity budget per request ms; re-armed on every output chunk. Must stay below timeoutMs').hidden(),
        stdinMode: z.union(['hold', 'close']).default('hold').description('Keep the request pipe open until ZCode exits (hold) or end it as soon as the prompt is written (close)').hidden(),
        maxConcurrent: z.natural().min(1).max(64).default(4).description('Max concurrent ZCode processes').hidden(),
        maxQueue: z.natural().max(256).default(32).description('Max queue length').hidden(),
        queueTimeoutMs: z.natural().max(3_600_000).default(30_000).description('Queue timeout ms').hidden(),
        maxOutputBytes: z.natural().min(1_024).max(64 * 1024 * 1024).default(8 * 1024 * 1024).description('Max output bytes').hidden(),
        maxEventLineLength: z.natural().min(1_024).max(8 * 1024 * 1024).default(1_048_576).description('Max event line length').hidden(),
        retryPolicy: RetryPolicyConfig.default({
            maxRetries: 2,
            backoffMs: 1_000,
            retryableCodes: [...ZCODE_RETRYABLE_CODES],
        }).hidden(),
    });
    const localized = schemaBase.i18n({
        'zh-CN': {
            enabled: { $description: '是否启用 ZCode 提供方' },
            provider: { $description: '提供方路由 ID（固定为 zcode）' },
            model: { $description: '默认模型 ID' },
            models: { $description: '显式模型目录；条目为基础 ID，可覆盖名称与上下文窗口' },
            visibleModels: { $description: '可见模型过滤；为空时显示全部目录条目，非空时仅显示列出的 ID' },
            modelDiscovery: { $description: '模型发现；off 表示只用静态目录（ZCode 0.17.0 无免配额的列模型命令）' },
            toolPolicy: { $description: '工具所有权：reject=拒绝 DSH 工具, zcode-owned=由 ZCode 执行, dsh-owned=由 DSH 执行' },
            mcpBridge: { $description: '把 DSH 工具注册表经 MCP 投影给 ZCode；仅在 toolPolicy=dsh-owned 时生效' },
            toolAllowlist: { $description: '传给 session/create.toolAllowlist 的工具名；留空则不下发该键（语义未在本机实测）' },
            toolDenylist: { $description: '传给 session/create.toolDenylist 的工具名；留空则不下发该键（语义未在本机实测）' },
            mode: { $description: 'CLI 权限模式（guarded=拒绝 CLI 工具调用；yolo=自动批准所有工具调用）' },
            sessionMode: { $description: '会话模式：full=每轮完整历史, resume=复用 ZCode 会话 ID' },
            sessionStorePath: { $description: '会话映射（DSH 会话→ZCode 会话）的落盘路径；留空用 DSH_HOME/zcode-provider/sessions.json，让 resume 模式在宿主重启后仍能续话' },
            passEnv: { $description: '额外允许传给 ZCode 子进程的宿主环境变量名；默认白名单之外一律不继承' },
            imageInput: { $description: '图片输入：off=关闭, experimental=实验通道' },
            isolatedHome: { $description: '给 CLI 子进程独立 HOME，并把宿主全局 AGENTS.md 种入 CLI 原生指令通道（受信任加载，不走粘贴文本）' },
            forwardSystemPrompt: { $description: '把 DSH 系统提示渲染进 CLI prompt；CLI 自带完整 agent 系统提示，默认关以隔离 DSH 预设内容并省每轮 token' },
            nodePath: { $description: '运行 CLI 的 Node 可执行文件路径；ZCode 0.17.0 需要 node:sqlite，即 Node >= 22' },
            zcodeCjsPath: { $description: 'ZCode CLI 入口脚本（resources/glm/zcode.cjs）' },
            timeoutMs: { $description: '单次请求的墙上时钟上限（毫秒）' },
            idleTimeoutMs: { $description: '单次请求的无输出静默预算（毫秒）；每有一块输出即重新计时' },
            stdinMode: { $description: '请求管道收尾方式：hold=等 ZCode 自己退出再关（默认）, close=写完即关' },
            maxConcurrent: { $description: '最大并发 ZCode 进程数' },
            maxQueue: { $description: '最大排队长度' },
            queueTimeoutMs: { $description: '排队超时（毫秒）' },
            maxOutputBytes: { $description: '单次 ZCode 输出最大字节' },
            maxEventLineLength: { $description: '单行事件最大长度' },
            retryPolicy: { $description: '重试策略：可重试错误码、次数与退避' },
        },
        en: {
            enabled: { $description: 'Enable ZCode provider' },
            provider: { $description: 'Provider route id (always zcode)' },
            model: { $description: 'Default model id' },
            models: { $description: 'Explicit model catalog; entries are base ids' },
            visibleModels: { $description: 'Visible models filter; empty shows every catalog entry, non-empty only shows the listed ids' },
            modelDiscovery: { $description: 'Model discovery; off keeps the static catalog (ZCode 0.17.0 has no quota-free model listing)' },
            toolPolicy: { $description: 'Tool ownership: reject, zcode-owned, dsh-owned' },
            mcpBridge: { $description: 'Project the DSH tool registry to ZCode over MCP; only honoured when toolPolicy is dsh-owned' },
            toolAllowlist: { $description: 'Tool names sent to session/create.toolAllowlist; empty sends no key (semantics not measured on this machine)' },
            toolDenylist: { $description: 'Tool names sent to session/create.toolDenylist; empty sends no key (semantics not measured on this machine)' },
            mode: { $description: 'CLI permission mode (guarded denies; yolo auto-approves all tool calls)' },
            sessionMode: { $description: 'Session mode: full or resume' },
            sessionStorePath: { $description: 'Path of the durable DSH session to ZCode session map; empty uses DSH_HOME/zcode-provider/sessions.json so resume keeps working after a host restart' },
            passEnv: { $description: 'Extra host environment variable names inherited by the ZCode child; everything outside the allowlist is dropped' },
            imageInput: { $description: 'Image input: off, or the experimental mode' },
            isolatedHome: { $description: 'Isolated CLI HOME, seeded with the host global AGENTS.md (trusted native channel)' },
            forwardSystemPrompt: { $description: 'Forward the DSH system prompt into the CLI prompt (default off: the CLI carries its own agent system prompt)' },
            nodePath: { $description: 'Node executable that runs the CLI; ZCode 0.17.0 needs node:sqlite, i.e. Node >= 22' },
            zcodeCjsPath: { $description: 'ZCode CLI entry script (resources/glm/zcode.cjs)' },
            timeoutMs: { $description: 'Per-request wall-clock ceiling (ms)' },
            idleTimeoutMs: { $description: 'Per-request inactivity budget (ms); re-armed on every output chunk' },
            stdinMode: { $description: 'How the request pipe is retired: hold=wait for ZCode to exit (default), close=end right after the prompt is written' },
            maxConcurrent: { $description: 'Max concurrent ZCode processes' },
            maxQueue: { $description: 'Max queue length' },
            queueTimeoutMs: { $description: 'Queue timeout (ms)' },
            maxOutputBytes: { $description: 'Max output bytes per ZCode process' },
            maxEventLineLength: { $description: 'Max event line length' },
            retryPolicy: { $description: 'Retry policy: eligible codes, attempts, backoff' },
        },
    });
    return localized
        .comment('其余字段在 cordis.patch.yml 中，请直接编辑对应段。 (dsh-zcode-cli)');
}
/** Programmatic library default: enabled=false, toolPolicy=reject. */
export const Config = createConfigSchema({ enabled: false, toolPolicy: 'dsh-owned' });
/** Bundle default for DSH profile plugin add: enabled=true, tools rejected. */
export const BundleConfig = createConfigSchema({ enabled: true, toolPolicy: 'dsh-owned' });
/**
 * Read a boolean config value that may be a volatile reference.
 *
 * `enabled` carries `.volatile()` so a settings change takes effect without a
 * restart. The host then hands `apply()` the reference object rather than the
 * primitive, and `reference === true` is *always* false — the exact bug that
 * kept the adapter unregistered. Both shapes are accepted here: a primitive
 * (programmatic config, tests) and any reference exposing a callable `get()`.
 */
export function configBoolean(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'object' && value !== null) {
        const getter = value.get;
        if (typeof getter === 'function')
            return configBoolean(getter.call(value));
    }
    return false;
}
/**
 * Like {@link configBoolean}, but an absent value takes `fallback`.
 *
 * Needed for flags that default to *on*: `configBoolean(undefined)` is `false`,
 * which would silently invert the documented default when a programmatic config
 * omits the key.
 */
export function configFlag(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'object') {
        const getter = value.get;
        if (typeof getter === 'function')
            return configFlag(getter.call(value), fallback);
    }
    return fallback;
}
/**
 * Resolve the effective catalog. Catalog membership is advisory; unknown exact
 * model ids remain valid request targets and are handled by the adapter's
 * resolveModel().
 */
export function configuredModels(config = {}) {
    const fallbackId = config.model?.trim() || DEFAULT_MODEL;
    const entries = config.models !== undefined && config.models.length > 0
        ? config.models
        : [{ id: fallbackId }];
    const catalog = [];
    const seen = new Set();
    for (const entry of entries) {
        const id = entry.id.trim();
        if (id.length === 0 || seen.has(id))
            continue;
        seen.add(id);
        catalog.push({ ...entry, id });
    }
    if (!seen.has(fallbackId))
        catalog.push({ id: fallbackId });
    return catalog;
}
/** Filter catalog by visibleModels (empty = all). */
export function filterVisibleModels(models, visibleModels) {
    if (visibleModels === undefined || visibleModels.length === 0)
        return models;
    const allow = new Set(visibleModels.map(id => id.trim()));
    return models.filter(m => allow.has(m.id));
}
//# sourceMappingURL=config.js.map