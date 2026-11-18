/**
 * Decryption of the ZCode plan credential (`zcodejwttoken`).
 *
 * The stored value has the shape `enc:v1:<iv_b64url>.<tag_b64url>.<ct_b64url>`
 * — AES-256-GCM, a 12-byte IV, a 16-byte tag, no AAD, and a key derived as
 * `sha256(ZCODE_CREDENTIAL_SECRET ?? "zcode-credential-fallback:<platform>:<homedir>:<username>")`.
 * These facts were read from the ZCode 0.17.0 CLI (`zcode.cjs`) and confirmed
 * by an end-to-end run on this host; do not guess at variations.
 *
 * Red line: the token value never enters a log, an error message, a return
 * value, or a written file. Every failure path names only *which step* failed.
 */
/** Failure codes; each names the step, never the secret. */
export type ZcodeCredentialErrorCode = 'ZCODE_CREDENTIAL_MISSING' | 'ZCODE_CREDENTIAL_INVALID' | 'ZCODE_CREDENTIAL_DECRYPT_FAILED';
export interface ZcodeCredentialErrorShape {
    readonly code: ZcodeCredentialErrorCode;
    readonly message: string;
}
/** Error thrown by this module; `code` is one of the three codes above. */
export declare class ZcodeCredentialError extends Error implements ZcodeCredentialErrorShape {
    readonly code: ZcodeCredentialErrorCode;
    constructor(code: ZcodeCredentialErrorCode, message: string);
}
/** Injectable dependencies so tests never touch the real file system. */
export interface ReadZcodePlanTokenDeps {
    /** Defaults to a UTF-8 file read; tests inject whole-file text. */
    readonly readFile?: ((path: string) => string) | undefined;
    /** Defaults to `ZCODE_CREDENTIAL_SECRET` with the derived fallback. */
    readonly secret?: (() => string) | undefined;
    readonly platform?: string;
    readonly homedir?: string;
    readonly username?: string;
}
/** Default secret resolution, mirroring zcode.cjs exactly. */
export declare function defaultCredentialSecret(envSecret: string | undefined): string;
/**
 * Decrypt one `enc:v1:…` value with `key`. Pure.
 *
 * @throws ZcodeCredentialError `ZCODE_CREDENTIAL_INVALID` on a malformed shape,
 * `ZCODE_CREDENTIAL_DECRYPT_FAILED` on bad key/IV/tag or a failed GCM check.
 */
export declare function decryptEncV1(value: string, key: Uint8Array): string;
/**
 * Read and decrypt the plan token for `dataBaseDir` (= `ZCODE_DATA_BASE_DIR`).
 *
 * @returns the JWT (a 204-character string on this host; the length is a
 * sanity hint, not a validation gate, so a future token length does not break
 * the channel).
 * @throws ZcodeCredentialError with one of the three codes; the message never
 * contains any credential material.
 */
export declare function readZcodePlanToken(dataBaseDir: string, deps?: ReadZcodePlanTokenDeps): string;
//# sourceMappingURL=credential.d.ts.map