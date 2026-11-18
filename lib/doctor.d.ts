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
import { type Config, type ModelConfig } from './provider/config.js';
import { type DiagnosticStatus, type EnvContractProbe, type ModelCatalogProbe, type NodeVersionProbe, type PathProbe, type ProviderConfigProbe, type QuotaObservation } from './diagnostics.js';
import type { ZcodeEnv } from './zcode/process.js';
/** Stable ids of the checks `runDoctor()` always reports, in report order. */
export declare const DOCTOR_CHECK_IDS: readonly ["node-version", "node-executable", "env-contract", "cli-entry", "builtin-config", "personal-config", "model-catalog", "last-quota"];
export type DoctorCheckId = typeof DOCTOR_CHECK_IDS[number];
/** One verdict in a doctor report. */
export interface DoctorCheck {
    readonly id: DoctorCheckId;
    readonly status: DiagnosticStatus;
    /** One line an operator can act on; carries the path or variable involved. */
    readonly detail: string;
    /** How to repair it, when the repair is not obvious from `detail`. */
    readonly hint?: string;
}
/** Inputs of {@link runDoctor}; every one of them is overridable for tests. */
export interface DoctorOptions {
    /** Environment to inspect; defaults to `process.env`. */
    readonly env?: ZcodeEnv;
    /** Version string of the Node that will run `zcode.cjs`; defaults to the host's. */
    readonly nodeVersion?: string;
    /** Plugin config; individual path options below win over it. */
    readonly config?: Config;
    readonly nodePath?: string;
    readonly zcodeCjsPath?: string;
    readonly builtinProviderConfigPath?: string;
    readonly personalProviderConfigPath?: string;
    readonly models?: readonly ModelConfig[];
    readonly defaultModel?: string;
    /** Reader for the provider configs; defaults to `readFileSync(path, 'utf8')`. */
    readonly readTextFile?: (path: string) => string;
    /**
     * Replaces the module-level quota recollection. `null` means "nothing
     * observed"; omitted means "use what the adapter recorded in this process".
     */
    readonly lastQuota?: QuotaObservation | null;
    /** Clock, for the report timestamp. */
    readonly now?: () => Date;
}
/** The paths the report was computed against. */
export interface DoctorPaths {
    readonly nodePath: string;
    readonly zcodeCjsPath: string;
    readonly builtinProviderConfigPath: string;
    readonly personalProviderConfigPath: string;
}
/** Machine-readable doctor report. Contains no plan-state verdict by design. */
export interface DoctorReport {
    readonly schemaVersion: 2;
    readonly plugin: 'dsh-zcode-cli';
    readonly checkedAt: string;
    /** No `fail` check. Warnings leave this `true`: they are drift, not breakage. */
    readonly ok: boolean;
    readonly status: Extract<DiagnosticStatus, 'pass' | 'warn' | 'fail'>;
    /** Always `false`: the doctor runs local probes only. */
    readonly quotaUsed: false;
    readonly node: NodeVersionProbe;
    readonly nodeExecutable: PathProbe;
    readonly env: EnvContractProbe;
    readonly cli: PathProbe;
    readonly configs: {
        readonly builtin: ProviderConfigProbe;
        readonly personal: ProviderConfigProbe;
    };
    readonly models: ModelCatalogProbe;
    readonly lastQuota: QuotaObservation | null;
    readonly paths: DoctorPaths;
    readonly checks: readonly DoctorCheck[];
    readonly notes: readonly string[];
}
/**
 * Aggregate every probe into one report.
 *
 * Reading order is the repair order: Node first (nothing runs below 22), then
 * the executable the plugin spawns, then the environment, then the CLI entry,
 * then the two configs, then the catalog the adapter will advertise.
 */
export declare function runDoctor(options?: DoctorOptions): Promise<DoctorReport>;
//# sourceMappingURL=doctor.d.ts.map