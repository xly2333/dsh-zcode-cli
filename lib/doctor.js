/**
 * Host doctor for the ZCode provider.
 *
 * One read-only report that says which of the moving parts is broken: Node
 * version, Node executable, the five-entry environment contract, the CLI entry
 * script, the built-in/personal provider configs, and the model catalog. It
 * never spawns ZCode, so it costs nothing to run and works while the account is
 * out of quota.
 *
 * Two constraints shape the whole file:
 *
 * 1. `quotaUsed` is always `false` and no field states or implies the account's
 *    plan state. The only plan-shaped datum is the *last observed* provider
 *    code 1309, a local recollection of a past rejection, not a query.
 * 2. Every probe is injectable (environment, paths, Node version, file reader),
 *    so `tests/doctor.test.mjs` can judge the verdicts against a fake host
 *    without reading this machine's real ZCode installation.
 */
import { DEFAULT_MODEL, DEFAULT_MODELS, DEFAULT_NODE_PATH, DEFAULT_ZCODE_CJS_PATH, } from './provider/config.js';
import { expectedEnvValue, lastQuotaObservation, probeEnvContract, probeModelCatalog, probeNodeVersion, probePath, probeProviderConfig, } from './diagnostics.js';
/** Stable ids of the checks `runDoctor()` always reports, in report order. */
export const DOCTOR_CHECK_IDS = [
    'node-version',
    'node-executable',
    'env-contract',
    'cli-entry',
    'builtin-config',
    'personal-config',
    'model-catalog',
    'last-quota',
];
function check(id, status, detail, hint) {
    return hint === undefined ? { id, status, detail } : { id, status, detail, hint };
}
function describeFailure(probe, label) {
    return `${label} not usable: ${probe.path} (${probe.error ?? `${probe.kind} missing`})`;
}
/**
 * Aggregate every probe into one report.
 *
 * Reading order is the repair order: Node first (nothing runs below 22), then
 * the executable the plugin spawns, then the environment, then the CLI entry,
 * then the two configs, then the catalog the adapter will advertise.
 */
export async function runDoctor(options = {}) {
    const config = options.config ?? {};
    const env = options.env ?? process.env;
    const nodeVersion = options.nodeVersion ?? process.versions.node;
    const now = options.now ?? (() => new Date());
    const nodePath = options.nodePath ?? config.nodePath ?? DEFAULT_NODE_PATH;
    const zcodeCjsPath = options.zcodeCjsPath ?? config.zcodeCjsPath ?? DEFAULT_ZCODE_CJS_PATH;
    const builtinProviderConfigPath = options.builtinProviderConfigPath
        ?? env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE
        ?? expectedEnvValue('ZCODE_BUILTIN_PROVIDER_CONFIG_FILE')
        ?? '';
    const personalProviderConfigPath = options.personalProviderConfigPath
        ?? env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE
        ?? expectedEnvValue('ZCODE_PERSONAL_PROVIDER_CONFIG_FILE')
        ?? '';
    const models = options.models ?? config.models ?? DEFAULT_MODELS;
    const defaultModel = options.defaultModel ?? config.model ?? DEFAULT_MODEL;
    const node = probeNodeVersion(nodeVersion);
    const nodeExecutable = probePath(nodePath, 'file');
    const envProbe = probeEnvContract(env);
    const cli = probePath(zcodeCjsPath, 'file');
    const builtin = probeProviderConfig(builtinProviderConfigPath, options.readTextFile);
    const personal = probeProviderConfig(personalProviderConfigPath, options.readTextFile);
    const catalog = probeModelCatalog(models, defaultModel);
    const lastQuota = options.lastQuota === undefined ? lastQuotaObservation() : options.lastQuota;
    const checks = [];
    const notes = [];
    // 1. Node version ---------------------------------------------------------
    checks.push(node.supported
        ? check('node-version', 'pass', `Node.js ${node.version} meets the minimum major ${node.minimum}`)
        : check('node-version', 'fail', `Node.js ${node.version} is below the required major ${node.minimum} (ZCode 0.17.0 loads node:sqlite)`, 'Install Node.js 22 or newer and point config.nodePath at it.'));
    // 2. Node executable ------------------------------------------------------
    if (!nodeExecutable.exists) {
        checks.push(check('node-executable', 'fail', describeFailure(nodeExecutable, 'Node executable'), 'Set config.nodePath to the node.exe that satisfies the version check.'));
    }
    else if (!nodeExecutable.correctType) {
        checks.push(check('node-executable', 'fail', `${nodePath} exists but is not a file`));
    }
    else {
        checks.push(check('node-executable', 'pass', `Node executable present: ${nodePath}`));
    }
    // 3. Environment contract -------------------------------------------------
    if (envProbe.missing.length > 0) {
        checks.push(check('env-contract', 'fail', `ZCode environment contract is incomplete: missing ${envProbe.missing.join(', ')}`, 'Restart DSH: the plugin bootstraps these at apply time (bootstrap-env.js), deriving them from the desktop runtime tree and the DSH home.'));
        notes.push('The ZCODE_* values are host paths; bootstrap-env.js derives them at apply time — restart DSH after a desktop update so the discovery re-runs.');
    }
    else if (envProbe.mismatched.length > 0) {
        checks.push(check('env-contract', 'warn', `Environment present but differs from the recorded install for ${envProbe.mismatched.join(', ')}`, 'Confirm the install moved on purpose; the recorded values reflect this host as of 2026-11-18 (bootstrap-derived), not a rule.'));
    }
    else {
        checks.push(check('env-contract', 'pass', 'All five environment contract entries present and as recorded'));
    }
    // 4. CLI entry ------------------------------------------------------------
    if (cli.exists && cli.correctType) {
        checks.push(check('cli-entry', 'pass', `ZCode CLI entry present: ${zcodeCjsPath}`));
    }
    else {
        checks.push(check('cli-entry', 'fail', describeFailure(cli, 'ZCode CLI entry'), 'Set config.zcodeCjsPath to resources/glm/zcode.cjs of the installed ZCode 0.17.0.'));
    }
    // 5. Built-in provider config --------------------------------------------
    checks.push(configCheck('builtin-config', builtin, 'Built-in provider config'));
    // 6. Personal provider config -------------------------------------------
    checks.push(configCheck('personal-config', personal, 'Personal provider config'));
    if (builtin.error !== null && builtin.exists && !builtin.parsed) {
        notes.push('The built-in provider config did not parse as JSON: ZCode will fail during bootstrap, not at request time.');
    }
    if (personal.exists && personal.parsed && personal.defaultModelSelection === null) {
        notes.push('The personal provider config lists no defaultModelSelection; design D2 then falls back to the static default.');
    }
    // 7. Model catalog --------------------------------------------------------
    if (!catalog.ok) {
        checks.push(check('model-catalog', 'fail', catalog.ids.length === 0
            ? 'No model is configured'
            : `Default model ${catalog.defaultModel} is not in the configured catalog (${catalog.ids.join(', ')})`, 'Use the static pair GLM-5.3-Flash / GLM-5.3; the adapter rejects any other id explicitly.'));
    }
    else if (catalog.unexpected.length > 0) {
        checks.push(check('model-catalog', 'warn', `Configured catalog lists ids the adapter cannot serve: ${catalog.unexpected.join(', ')}`, 'Remove them or extend DEFAULT_MODELS; an unserved id fails at request time.'));
    }
    else {
        checks.push(check('model-catalog', 'pass', `Catalog ${catalog.ids.join(', ')}; default ${catalog.defaultModel}`));
    }
    // 8. Last observed quota rejection ---------------------------------------
    if (lastQuota === null) {
        checks.push(check('last-quota', 'pass', 'No quota rejection observed in this process; plan state is not probed locally'));
    }
    else {
        checks.push(check('last-quota', 'warn', `Last observed provider code ${lastQuota.providerCode ?? 'unknown'} at ${lastQuota.observedAt}`, 'Provider code 1309 means the ZCode account was rejected as out of quota. The plugin cannot judge plan state; check the account.'));
        notes.push('Provider code 1309 is a rejection seen while calling ZCode, not a measurement: renew or switch account, then retry.');
    }
    const status = checks.some(item => item.status === 'fail')
        ? 'fail'
        : checks.some(item => item.status === 'warn') ? 'warn' : 'pass';
    return {
        schemaVersion: 2,
        plugin: 'dsh-zcode-cli',
        checkedAt: now().toISOString(),
        ok: status !== 'fail',
        status,
        quotaUsed: false,
        node,
        nodeExecutable,
        env: envProbe,
        cli,
        configs: { builtin, personal },
        models: catalog,
        lastQuota,
        paths: { nodePath, zcodeCjsPath, builtinProviderConfigPath, personalProviderConfigPath },
        checks,
        notes,
    };
}
/**
 * Judge one provider config file.
 *
 * Missing, unreadable, and unparseable are all `fail`: ZCode refuses to start
 * unless both the built-in and the personal config are supplied, so a "warn"
 * here would hide a guaranteed startup failure.
 */
function configCheck(id, probe, label) {
    if (!probe.exists) {
        return check(id, 'fail', `${label} missing: ${probe.path}`, 'Point the matching ZCODE_* variable at the file, or let bootstrap-env.js rediscover it on the next DSH restart.');
    }
    if (!probe.readable) {
        return check(id, 'fail', `${label} unreadable: ${probe.path} (${probe.error ?? 'read failed'})`);
    }
    if (!probe.parsed) {
        return check(id, 'fail', `${label} is not valid JSON: ${probe.path} (${probe.error ?? 'parse failed'})`);
    }
    return check(id, 'pass', `${label} readable: ${probe.path}`);
}
//# sourceMappingURL=doctor.js.map