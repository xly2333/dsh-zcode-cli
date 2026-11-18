/**
 * Stable error surface of the ZCode provider.
 *
 * Everything downstream (adapter, stream framing, UI message, retry executor)
 * keys off `ZcodeError.code`, never off a message string: ZCode 0.17.0 writes
 * its failures to stderr as free-form Chinese text plus a bracketed provider
 * code, and only the code is stable across releases.
 *
 * This module is deliberately dependency-free and pure: it maps text to a
 * classified error, nothing else. It runs no process, reads no file, and never
 * touches `process.env`, so both the adapter and the offline tests can import it
 * without a ZCode installation present.
 */
/** Every code the provider can raise. Frozen: consumers switch on this union. */
export declare const ZCODE_ERROR_CODES: readonly ["QUOTA", "RATE_LIMIT", "PERMISSION_REQUIRED", "AUTH", "ZCODE_ENV_MISSING", "MODEL_NOT_FOUND", "ZCODE_PARSE", "ZCODE_EXIT", "ZCODE_UNKNOWN", "TIMEOUT", "ABORTED", "UNSUPPORTED_TOOLS", "UNSUPPORTED_OPTION", "UNSUPPORTED_CONTENT", "ZCODE_BUSY", "ZCODE_OUTPUT_TOO_LARGE", "WORKSPACE_UNAVAILABLE", "ZCODE_CREDENTIAL_MISSING", "ZCODE_CREDENTIAL_INVALID", "ZCODE_CREDENTIAL_DECRYPT_FAILED"];
export type ZcodeErrorCode = typeof ZCODE_ERROR_CODES[number];
/** How much stderr text is retained on an error for diagnostics. */
export declare const STDERR_TAIL_MAX_CHARS = 2048;
/** Ceiling on `message` and `providerMessage`; third-party text never grows past this. */
export declare const DIAGNOSTIC_MAX_CHARS = 4096;
/**
 * Remove the credential-shaped substrings third-party text tends to carry.
 *
 * Light by design: three well-known shapes only (`Bearer …`, `token|key|sig=…`
 * query parameters, `sk-…` keys). Anything broader would start rewriting model
 * prose, which this provider has no business editing.
 */
export declare function sanitizeSecrets(text: string): string;
/** Bound and sanitize one diagnostic string. */
export declare function boundDiagnostic(text: string): string;
export declare function boundDiagnostic(text: string | undefined): string | undefined;
/** Type guard for the frozen code list. */
export declare function isZcodeErrorCode(value: unknown): value is ZcodeErrorCode;
/** Extra machine-readable facts attached to a classified failure. */
export interface ZcodeErrorOptions {
    /** Numeric provider code from the bracketed stderr prefix, e.g. 1309. */
    providerCode?: number;
    /** Human message ZCode attached to the provider code. */
    providerMessage?: string;
    /** HTTP status when the failure came from an HTTP response. */
    responseStatus?: number;
    /** Per-request id from the third stderr bracket, e.g. `2026102401123552bbdbe6a99a4f3d`. */
    requestId?: string;
    /** Trailing stderr text, bounded by {@link STDERR_TAIL_MAX_CHARS}. */
    stderrTail?: string;
    /** Underlying error, if this one wraps another. */
    cause?: unknown;
}
/**
 * The single error type of this provider.
 *
 * `code` is always one of {@link ZCODE_ERROR_CODES}; the diagnostic fields are
 * declared as `T | undefined` rather than optional so that
 * `exactOptionalPropertyTypes` consumers can read them without narrowing first.
 */
export declare class ZcodeError extends Error {
    readonly code: ZcodeErrorCode;
    readonly providerCode: number | undefined;
    readonly providerMessage: string | undefined;
    readonly responseStatus: number | undefined;
    readonly requestId: string | undefined;
    readonly stderrTail: string | undefined;
    constructor(code: ZcodeErrorCode, message: string, options?: ZcodeErrorOptions);
}
/** Type guard for a value raised by this provider. */
export declare function isZcodeError(value: unknown): value is ZcodeError;
/**
 * Bound and normalize a stderr capture for attachment to an error.
 *
 * The returned string is never longer than {@link STDERR_TAIL_MAX_CHARS}: the
 * ellipsis that marks the cut counts against the budget, so a caller can size a
 * log field from the constant alone.
 */
export declare function boundStderrTail(stderr: string | undefined): string | undefined;
/** Inputs to {@link classifyStderr} beyond the stderr text itself. */
export interface ClassifyOptions {
    /** Child exit code; `null` when the process was killed by a signal. */
    exitCode?: number | null;
    /** Exit signal, when the child was terminated rather than exited. */
    signal?: string | null;
    /** Set when `--verbose` was used, enabling the `Cause:` fallback. */
    verbose?: boolean;
}
/**
 * Map a finished ZCode process to a {@link ZcodeError}.
 *
 * Resolution order is most-specific first, because a single stderr capture can
 * satisfy several rules (a 429 that also says "quota" must classify as QUOTA):
 *
 * 1. the bracketed provider code (1309 / 3007 / 3012);
 * 2. an HTTP status (401 / 429 / 403);
 * 3. a distinctive message (env contract, auth identity, unknown model);
 * 4. a transport failure — retryable, so `ZCODE_UNKNOWN`;
 * 5. the exit code alone — `ZCODE_EXIT`.
 *
 * `ZCODE_PARSE`, `TIMEOUT` and `ABORTED` are never produced here: the parser and
 * the process supervisor raise those directly.
 */
export declare function classifyStderr(stderr: string, options?: ClassifyOptions): ZcodeError;
//# sourceMappingURL=error-codes.d.ts.map