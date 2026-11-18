/**
 * Environment bootstrap (2026-11-17 固化)。
 *
 * 把"启动 DSH 的宿主必须手工准备的环境"收敛成插件加载时的一次自举:
 *  1. 契约五项(ZCODE_HOME / ZCODE_DATA_BASE_DIR / BUILTIN / PERSONAL)自动推导;
 *  2. CLI 专用个人配置派生(过滤指向本地回环桥的 provider,补 defaultModelSelection);
 *  3. 桌面端官方管道(--surface desktop)的端点与 token 动态发现:
 *     管道名枚举 \\.\pipe\,token 从桌面端的 zcode.cjs 子进程环境块读取。
 *
 * 全部幂等:已有值一律保留,只补缺。写 process.env 仅影响本进程与
 * 由此 spawn 的 CLI 子进程,不写注册表、不动桌面端。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
let loggerRef = null;
function say(message) {
    if (loggerRef) loggerRef(message);
    else console.log(`[zcode-bootstrap] ${message}`);
}

/** 发现最新的 zcode-builtin.json(DSH 的 runtime provider 目录)。 */
function discoverBuiltinConfig() {
    const root = join(process.env.ZCODE_DATA_BASE_DIR ?? homedir(), '.zcode', 'v2', 'runtime', 'provider');
    let best = null;
    try {
        for (const arch of readdirSync(root)) {
            const archDir = join(root, arch);
            for (const ver of readdirSync(archDir)) {
                const verDir = join(archDir, ver);
                for (const ep of readdirSync(verDir)) {
                    const candidate = join(verDir, ep, 'zcode-builtin.json');
                    if (!existsSync(candidate))
                        continue;
                    const st = statSafe(candidate);
                    if (st && (best === null || st.mtimeMs > best.mtimeMs))
                        best = { path: candidate, mtimeMs: st.mtimeMs };
                }
            }
        }
    }
    catch {
        return undefined;
    }
    return best?.path;
}

/**
 * 桌面端当前引擎版本(ZCODE_APP_VERSION 推导,2026-11-18)。
 *
 * 桌面链启动时由桌面把自身版本注入进程环境,CLI 用它构造 x-zcode-app-version;
 * DSH 脱离桌面链启动(手动拉起/计划任务)时环境里没有,CLI 回退到旧 bundle 的
 * 构建版本号(0.17.1),zcode.z.ai 会以 3012 "client not supported" 拒绝。
 *
 * 推导信号:活跃快照版本目录名——桌面持续刷新活跃快照的
 * zcode-builtin-refresh.json(其 mtime 始终跟随桌面升级),取其所属版本目录;
 * 无 refresh 信号时退回最高 semver 版本目录(排除 0.0.0-dev 等开发快照)。
 */
function discoverAppVersion() {
    const root = join(process.env.ZCODE_DATA_BASE_DIR ?? homedir(), '.zcode', 'v2', 'runtime', 'provider');
    let best = null;
    const versions = [];
    try {
        for (const arch of readdirSync(root)) {
            const archDir = join(root, arch);
            for (const ver of readdirSync(archDir)) {
                if (!/^(\d+\.\d+\.\d+)$/.test(ver))
                    continue;
                versions.push(ver);
                const verDir = join(archDir, ver);
                for (const ep of readdirSync(verDir)) {
                    const st = statSafe(join(verDir, ep, 'zcode-builtin-refresh.json'));
                    if (st && (best === null || st.mtimeMs > best.mtimeMs))
                        best = { ver, mtimeMs: st.mtimeMs };
                }
            }
        }
    }
    catch {
        return undefined;
    }
    if (best)
        return best.ver;
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions[0];
}
function statSafe(path) {
    try {
        const st = statSync(path);
        return { mtimeMs: st.mtimeMs };
    }
    catch {
        return null;
    }
}

/**
 * 从桌面版个人供应商配置派生 CLI 专用配置:
 * 过滤所有 baseUrl 指向本地回环桥的 provider(避免 CLI 的模型请求打回 DSH
 * 形成递归),并确保 defaultModelSelection 指向 GLM-5.3-Flash。
 * 结果缓存到 <DSH_HOME>/zcode-provider/provider_config.cli.json,
 * 源文件变更(revision/mtime)时重新派生。
 */
function deriveCliProviderConfig(logger) {
    const source = process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_SOURCE
        ?? join(process.env.ZCODE_DATA_BASE_DIR ?? homedir(), '.zcode', 'v2', 'provider_config.json');
    if (!existsSync(source))
        return undefined;
    const outDir = join(nonEmpty(process.env.DSH_HOME) ?? homedir(), 'zcode-provider');
    const outPath = join(outDir, 'provider_config.cli.json');
    const stampPath = `${outPath}.source-stamp`;
    try {
        const st = statSync(source);
        // :v2 = 2026-11-19 派生逻辑升位(contextWindow 修正),旧格式 stamp 必失配,
        // 强制对已存在的派生副本重派生一次,自愈其中的 400k 错值。
        const stamp = `${st.size}:${st.mtimeMs}:v2`;
        if (existsSync(outPath) && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === stamp) {
            return outPath; // 未变化,直接复用
        }
        const raw = readFileSync(source, 'utf8').replace(/^\uFEFF/, '');
        const doc = JSON.parse(raw);
        const rules = doc.config?.providerConfigRules?.providerRules;
        if (Array.isArray(rules)) {
            doc.config.providerConfigRules.providerRules = rules.filter((rule) => {
                const base = rule?.config?.api?.baseUrl ?? '';
                return !/127\.0\.0\.1|localhost|\[::1\]/.test(String(base)); // 剔除本地桥
            });
        }
        const order = Array.isArray(doc.config?.providerOrder) ? doc.config.providerOrder : [];
        doc.config.providerOrder = order.filter((id) => {
            const rule = (doc.config.providerConfigRules.providerRules ?? []).find(r => r.providerId === id);
            return rule !== undefined || !/deepseek/i.test(String(id)); // 本地桥 id 一并剔出顺序表
        });
        doc.config.defaultModelSelection = { providerId: 'glm', modelId: 'GLM-5.3-Flash' };
        // CLI 侧模型元数据修正(2026-11-19):派生副本曾出现 GLM-5.3-Flash
        // contextWindow=400000 的孤例错值(桌面源为 1000000,服务端实测 819037 tokens
        // 可通过,与 1M 真实窗口吻合)。这里对 start-plan 路由的 GLM 模型显式对齐
        // 桌面源声明;stamp 版本升位(:v2)让旧错值在下次 bootstrap 时被重派生自愈。
        try {
            const modelRules = doc.config?.modelConfigRules?.providerModelRules;
            if (Array.isArray(modelRules)) {
                for (const rule of modelRules) {
                    if (rule?.modelId === 'GLM-5.3-Flash' && rule?.providerId === 'account:zai-start-plan') {
                        rule.config = rule.config ?? {};
                        rule.config.properties = rule.config.properties ?? {};
                        if (rule.config.properties.contextWindow !== 1000000) {
                            logger?.('glm contextWindow corrected: ' + rule.config.properties.contextWindow + ' -> 1000000');
                            rule.config.properties.contextWindow = 1000000;
                        }
                    }
                }
            }
        }
        catch (error) {
            logger?.('glm contextWindow correction failed: ' + String(error?.message ?? error));
        }
        mkdirSync(outDir, { recursive: true });
        writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8');
        writeFileSync(stampPath, stamp, 'utf8');
        logger?.('cli provider config derived: ' + outPath);
        return outPath;
    }
    catch (error) {
        logger?.('cli provider config derivation failed: ' + String(error?.message ?? error));
        return undefined;
    }
}

/** 枚举桌面端官方管道名(桌面运行时才存在)。 */
export function discoverOfficialPipe() {
    try {
        const hits = readdirSync('\\\\.\\pipe\\').filter((n) => n.startsWith('zcode-official-'));
        return hits.length > 0 ? `\\\\.\\pipe\\${hits[0]}` : undefined;
    }
    catch {
        return undefined;
    }
}

/**
 * 从桌面端的 zcode.cjs 子进程环境块读取官方管道 token。
 * PowerShell + NtQueryInformationProcess:遍历进程,命中 CommandLine 含
 * zcode.cjs 且环境含 ZCODE_OFFICIAL_ENDPOINT_TOKEN 的进程。
 */
export function discoverOfficialPipeToken() {
    const ps = String.raw`
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ProcEnv {
    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr h, int cls, ref IntPtr pbi, int len, out int ret);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
    [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    public static string ReadEnv(int pid, string wantKey) {
        IntPtr h = OpenProcess(0x0410, false, pid);
        if (h == IntPtr.Zero) return null;
        try {
            IntPtr pbi = Marshal.AllocHGlobal(0x1000);
            int ret;
            int status = NtQueryInformationProcess(h, 0, ref pbi, 0x1000, out ret);
            if (status != 0) return null;
            long PebAddress = Marshal.ReadInt64(pbi, 0x8);
            Marshal.FreeHGlobal(pbi);
            byte[] peb = new byte[0x200];
            IntPtr got;
            if (!ReadProcessMemory(h, (IntPtr)PebAddress, peb, peb.Length, out got)) return null;
            long paramsAddr = BitConverter.ToInt64(peb, 0x20);
            byte[] pp = new byte[0x400];
            if (!ReadProcessMemory(h, (IntPtr)paramsAddr, pp, pp.Length, out got)) return null;
            long envAddr = BitConverter.ToInt64(pp, 0x80);
            long envSize = BitConverter.ToInt64(pp, 0x88);
            if (envAddr == 0 || envSize <= 0 || envSize > 0x4000000) return null;
            byte[] env = new byte[envSize];
            if (!ReadProcessMemory(h, (IntPtr)envAddr, env, env.Length, out got)) return null;
            string block = Encoding.Unicode.GetString(env);
            foreach (var part in block.Split('\0')) {
                int eq = part.IndexOf('=');
                if (eq <= 0) continue;
                var key = part.Substring(0, eq);
                if (string.Equals(key, wantKey, StringComparison.OrdinalIgnoreCase))
                    return part.Substring(eq + 1);
            }
            return null;
        } finally { CloseHandle(h); }
    }
}
'@
Add-Type -TypeDefinition $code
$tokenValue = $null
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    if ($tokenValue) { return }
    if ($_.CommandLine -notmatch 'zcode\.cjs') { return }
    try {
        $v = [ProcEnv]::ReadEnv([int]$_.ProcessId, 'ZCODE_OFFICIAL_ENDPOINT_TOKEN')
        if ($v) { $tokenValue = $v }
    } catch {}
}
if ($tokenValue) { Write-Output ('OK:' + $tokenValue) } else { Write-Output 'NONE' }
`;
    try {
        const out = execSync(`powershell -NoProfile -EncodedCommand ${Buffer.from(ps, 'utf16le').toString('base64')}`, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
        const line = out.split('\n').map(s => s.trim()).find(s => s === 'OK' || s.startsWith('OK:'));
        if (line && line.startsWith('OK:'))
            return line.slice(3);
        return undefined;
    }
    catch {
        return undefined;
    }
}

/** 主入口:幂等地补齐全部环境。在插件 apply 最早期调用一次。 */
export function bootstrapEnvironment(logger) {
    loggerRef = logger ?? null;
    const dshHome = nonEmpty(process.env.DSH_HOME) ?? join(homedir(), '.dsh');
    const zcodeData = nonEmpty(process.env.ZCODE_DATA_BASE_DIR) ?? homedir();
    if (!nonEmpty(process.env.ZCODE_HOME))
        process.env.ZCODE_HOME = join(zcodeData, '.zcode');
    if (!nonEmpty(process.env.ZCODE_DATA_BASE_DIR))
        process.env.ZCODE_DATA_BASE_DIR = zcodeData;
    if (!nonEmpty(process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE)) {
        const builtin = discoverBuiltinConfig();
        if (builtin) {
            process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtin;
            say('builtin config discovered: ' + builtin);
        }
    }
    // PERSONAL 无条件派生覆盖:宿主/注册表给的通常是桌面版个人配置(可能含
    // 指向本地回环桥的 provider),CLI 拿到会把模型请求打回 DSH 形成递归。
    // 派生结果只进本进程环境,注册表与桌面端不受影响。
    {
        const cli = deriveCliProviderConfig(logger);
        if (cli) {
            process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = cli;
            say('cli provider config: ' + cli);
        }
    }
    // 桌面管道:DSH 进程环境没有时动态发现(token 用内存兜底读一次)
    if (!nonEmpty(process.env.ZCODE_OFFICIAL_ENDPOINT)) {
        const pipe = discoverOfficialPipe();
        if (pipe) {
            process.env.ZCODE_OFFICIAL_ENDPOINT = pipe;
            say('official pipe discovered: ' + pipe);
            if (!nonEmpty(process.env.ZCODE_OFFICIAL_ENDPOINT_TOKEN)) {
                const token = discoverOfficialPipeToken();
                if (token) {
                    process.env.ZCODE_OFFICIAL_ENDPOINT_TOKEN = token;
                    say('official pipe token discovered (in memory)');
                }
            }
        }
    }
    // Start Plan 账号指纹变量(桌面端同款):存在则透传给 CLI 的逻辑在 passEnv
    if (!nonEmpty(process.env.ZCODE_WINDOWS_APP_INSTALL_DIR)) {
        for (const candidate of ['F:\\app\\zcode', 'C:\\app\\zcode', 'D:\\app\\zcode']) {
            if (existsSync(join(candidate, 'resources', 'glm', 'zcode.cjs'))) {
                process.env.ZCODE_WINDOWS_APP_INSTALL_DIR = candidate;
                break;
            }
        }
    }
    // 客户端版本指纹(2026-11-18):CLI 以 ZCODE_APP_VERSION 构造 x-zcode-app-version,
    // 缺失时回退 bundle 构建版本号,被 zcode.z.ai 以 3012 拒绝。桌面注入的值优先,
    // 只在宿主环境缺失时按活跃快照推导。
    if (!nonEmpty(process.env.ZCODE_APP_VERSION)) {
        const appVersion = discoverAppVersion();
        if (appVersion) {
            process.env.ZCODE_APP_VERSION = appVersion;
            say('app version derived from active snapshot: ' + appVersion);
        }
    }
    return {
        dshHome,
        zcodeData: process.env.ZCODE_DATA_BASE_DIR,
        hasPipe: nonEmpty(process.env.ZCODE_OFFICIAL_ENDPOINT) !== undefined,
    };
}
