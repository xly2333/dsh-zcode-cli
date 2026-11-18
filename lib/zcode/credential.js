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
import { createDecipheriv, createHash } from 'node:crypto';
import { homedir as osHomedir, platform as osPlatform, userInfo } from 'node:os';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
/** Error thrown by this module; `code` is one of the three codes above. */
export class ZcodeCredentialError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ZcodeCredentialError';
        this.code = code;
    }
}
const ENC_PREFIX = 'enc:v1:';
const ENC_V2_PREFIX = 'enc:v2:';
// enc:v2(2026-11-17 逆向自 ZCode 3.18.2 的 zcode.cjs):`enc:v2:<os|env>:<sha256(key)hex 前 24>:<iv.tag.ct>`
// 密钥存 Windows 凭据管理器(@napi-rs/keyring):service="ZCode Credential Encryption",
// user=sha256(credentials.json 绝对路径) 的 hex,target=`<user>.<service>`。密钥只在内存传递。
const KEYRING_SERVICE = 'ZCode Credential Encryption';
let v2KeyCache = null;
function readWindowsKeyringKey() {
    // 1. 枚举凭据管理器里本插件的条目(cmdkey /list),拿确切 target
    let list;
    try {
        list = execSync('cmdkey /list', { encoding: 'utf8' });
    }
    catch {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_MISSING', 'OS keyring enumeration failed (cmdkey)');
    }
    const targets = [...list.matchAll(/target=(.+\.ZCode Credential Encryption)/g)].map(m => m[1]);
    if (targets.length === 0) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_MISSING', 'OS keyring has no ZCode credential encryption entry');
    }
    // 2. CredRead(P/Invoke)取出 32 字节密钥;blob 按 UTF-16/UTF-8 双解码尝试
    const ps = `
$src = 'using System; using System.Runtime.InteropServices; public class CR3 { [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr); [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; } public static byte[][] Read(string target) { IntPtr ptr; if (!CredRead(target, 1, 0, out ptr)) return null; CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL)); byte[] blob = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, blob, 0, c.CredentialBlobSize); return new byte[][] { System.Text.Encoding.Unicode.GetBytes(c.UserName ?? ""), blob }; } }'
Add-Type -TypeDefinition $src
$r = [CR3]::Read('${targets[0].replace(/'/g, "''")}')
if ($r -eq $null) { Write-Output 'NULL'; exit }
$u16 = [Text.Encoding]::Unicode.GetString($r[1])
$u8 = [Text.Encoding]::UTF8.GetString($r[1])
function TryB64($s) { try { $t = $s.Trim().Replace('-','+').Replace('_','/'); while ($t.Length % 4) { $t += '=' }; $b = [Convert]::FromBase64String($t); return $b } catch { return $null } }
$b1 = TryB64 $u16; $b2 = TryB64 $u8
if ($b1 -and $b1.Length -eq 32) { Write-Output ('U16:' + [Convert]::ToBase64String($b1)) }
elseif ($b2 -and $b2.Length -eq 32) { Write-Output ('U8:' + [Convert]::ToBase64String($b2)) }
else { Write-Output 'BAD' }`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    let out;
    try {
        out = execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
    catch {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_MISSING', 'OS keyring read failed (CredRead)');
    }
    // PowerShell 的 -EncodedCommand 输出可能带 CLIXML 前缀行,取最后一段有效行
    const line = out.split('\n').map(s => s.trim()).filter(s => /^(U16|U8|BAD|NULL):/.test(s) || s === 'NULL' || s === 'BAD').pop();
    if (!line || line === 'NULL' || line === 'BAD') {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_MISSING', 'OS keyring entry did not yield a 32-byte key');
    }
    return Buffer.from(line.slice(4), 'base64');
}
function v2KeyFor(fingerprint) {
    if (v2KeyCache && v2KeyCache.fingerprint === fingerprint)
        return v2KeyCache.key;
    const keyBuf = readWindowsKeyringKey();
    const actual = createHash('sha256').update(keyBuf).digest('hex').slice(0, 24);
    if (actual !== fingerprint) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'enc:v2 key fingerprint does not match the stored credential');
    }
    v2KeyCache = { key: keyBuf, fingerprint };
    return keyBuf;
}
/** Decrypt one `enc:v2:<os|env>:<fingerprint>:<iv.tag.ct>` value (ZCode 3.18 format). */
export function decryptEncV2(value) {
    const parts = value.slice(ENC_V2_PREFIX.length).split(':');
    if (parts.length !== 3 || !['os', 'env'].includes(parts[0]) || !/^[a-f0-9]{24}$/.test(parts[1])) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credential is not an enc:v2 os/env payload');
    }
    const [, fingerprint, body] = parts;
    const key = v2KeyFor(fingerprint);
    const [ivB64, tagB64, dataB64] = body.split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'enc:v2 payload is missing the iv.tag.ciphertext triple');
    }
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
        const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
        if (plain.length === 0) {
            throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'credential decrypted to an empty value');
        }
        return plain;
    }
    catch (cause) {
        if (cause instanceof ZcodeCredentialError)
            throw cause;
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'enc:v2 GCM authentication failed');
    }
}
/** Default secret resolution, mirroring zcode.cjs exactly. */
export function defaultCredentialSecret(envSecret) {
    const fromEnv = envSecret?.trim();
    if (fromEnv !== undefined && fromEnv.length > 0)
        return fromEnv;
    let username = 'unknown';
    try {
        username = userInfo().username;
    }
    catch {
        // Fall through with the placeholder, same as the CLI.
    }
    return `zcode-credential-fallback:${osPlatform()}:${osHomedir()}:${username}`;
}
/**
 * Decrypt one `enc:v1:…` value with `key`. Pure.
 *
 * @throws ZcodeCredentialError `ZCODE_CREDENTIAL_INVALID` on a malformed shape,
 * `ZCODE_CREDENTIAL_DECRYPT_FAILED` on bad key/IV/tag or a failed GCM check.
 */
export function decryptEncV1(value, key) {
    if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credential value is not an enc:v1: payload');
    }
    const body = value.slice(ENC_PREFIX.length);
    const parts = body.split('.');
    if (parts.length !== 3 || parts.some(part => part.length === 0)) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credential value is not the iv.tag.ciphertext triple');
    }
    const [ivPart, tagPart, dataPart] = parts;
    const iv = decodeB64Url(ivPart, 'iv');
    const tag = decodeB64Url(tagPart, 'auth tag');
    const data = decodeB64Url(dataPart, 'ciphertext');
    if (iv.length !== 12) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'credential iv is not 12 bytes');
    }
    if (tag.length !== 16) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'credential auth tag is not 16 bytes');
    }
    if (key.length !== 32) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'credential key is not 32 bytes');
    }
    let decipher;
    try {
        decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
    }
    catch {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'cipher init failed (bad key or iv)');
    }
    try {
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]);
        const text = plain.toString('utf8');
        // Never echo the plaintext back through an error path.
        if (text.length === 0) {
            throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'credential decrypted to an empty value');
        }
        return text;
    }
    catch (cause) {
        if (cause instanceof ZcodeCredentialError)
            throw cause;
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_DECRYPT_FAILED', 'GCM authentication failed (wrong key or tampered ciphertext)');
    }
}
function decodeB64Url(part, what) {
    const buf = Buffer.from(part, 'base64url');
    if (buf.length === 0) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', `credential ${what} is not valid base64url`);
    }
    return buf;
}
function credentialKey(secret) {
    return createHash('sha256').update(secret).digest();
}
/**
 * Read and decrypt the plan token for `dataBaseDir` (= `ZCODE_DATA_BASE_DIR`).
 *
 * @returns the JWT (a 204-character string on this host; the length is a
 * sanity hint, not a validation gate, so a future token length does not break
 * the channel).
 * @throws ZcodeCredentialError with one of the three codes; the message never
 * contains any credential material.
 */
export function readZcodePlanToken(dataBaseDir, deps = {}) {
    const readFile = deps.readFile ?? ((path) => readFileSync(path, 'utf8'));
    const path = join(dataBaseDir, '.zcode', 'v2', 'credentials.json');
    let raw;
    try {
        raw = readFile(path);
    }
    catch {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_MISSING', `cannot read ZCode credentials file at ${path}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credentials file is not valid JSON');
    }
    const token = parsed?.['zcodejwttoken'];
    if (typeof token !== 'string' || token.length === 0) {
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credentials file has no zcodejwttoken entry');
    }
    // ZCode 3.18+ 写 enc:v2(OS 凭据管理器密钥),插件直接接管解密;enc:v1 走原路径。
    if (token.startsWith(ENC_V2_PREFIX)) {
        const plain = decryptEncV2(token);
        if (plain.length === 0) {
            throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credential decrypted to an empty token');
        }
        return plain;
    }
    const secret = deps.secret ?? (() => defaultCredentialSecret(process.env['ZCODE_CREDENTIAL_SECRET']));
    const key = credentialKey(secret());
    const plain = decryptEncV1(token, new Uint8Array(key));
    if (plain.length === 0) {
        // Report only the emptiness, never the value.
        throw new ZcodeCredentialError('ZCODE_CREDENTIAL_INVALID', 'credential decrypted to an empty token');
    }
    return plain;
}
//# sourceMappingURL=credential.js.map