import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { SessionRegistry, type EnumerableSessionStore, type SessionRecord, type SessionStore } from './store.js';
/** Directory under `DSH_HOME` that belongs to this plugin. */
export declare const ZCODE_PROVIDER_DIR = "zcode-provider";
/** File name of the durable session map. */
export declare const ZCODE_SESSION_FILE = "sessions.json";
/** On-disk format version; a mismatch discards the file rather than guessing. */
export declare const ZCODE_SESSION_FILE_VERSION = 1;
/** Environment slice the path resolution reads. */
export type DshEnv = Readonly<Record<string, string | undefined>>;
/**
 * Resolve `DSH_HOME`.
 *
 * `DSH_HOME` wins when set (the host may relocate its home), otherwise the
 * conventional `~/.dsh` is used. This mirrors the DSH home resolution the rest
 * of the harness performs; it is duplicated here rather than imported because
 * `dsh-home-paths` is a devDependency of this package and the runtime
 * dependency list is frozen at zero.
 */
export declare function resolveDshHome(env?: DshEnv): string;
/** Default location of the durable session map. */
export declare function defaultSessionStorePath(env?: DshEnv): string;
/**
 * Resolve the configured path.
 *
 * @param configured - `config.sessionStorePath`; empty or blank means "default".
 * @param env - environment used for the default.
 */
export declare function sessionStorePath(configured: string | undefined, env?: DshEnv): string;
/** The fs surface {@link FileSessionStore} writes through (tests inject spies). */
export interface FileStoreFs {
    readonly mkdirSync: typeof mkdirSync;
    readonly writeFileSync: typeof writeFileSync;
    readonly renameSync: typeof renameSync;
    readonly rmSync: typeof rmSync;
}
/** Options of {@link FileSessionStore}. */
export interface FileSessionStoreOptions {
    /** Clock override for retention tests. */
    readonly now?: (() => number) | undefined;
    /** Record ceiling; defaults to {@link SESSION_MAX_RECORDS}. */
    readonly maxRecords?: number | undefined;
    /** Age ceiling; defaults to {@link SESSION_MAX_AGE_MS}. */
    readonly maxAgeMs?: number | undefined;
    /** Filesystem seam; defaults to `node:fs` (tests observe the write sequence). */
    readonly fs?: FileStoreFs | undefined;
}
/**
 * Session map persisted as one JSON file.
 *
 * Reads are lazy and synchronous: the first access performs the (small) file
 * read, so constructing the store never touches the disk and a host that only
 * ever uses `sessionMode: 'full'` pays nothing for the feature.
 */
export declare class FileSessionStore implements EnumerableSessionStore {
    readonly path: string;
    private readonly records;
    private readonly now;
    private readonly maxRecords;
    private readonly maxAgeMs;
    private readonly fs;
    private loaded;
    private saveError;
    private loadError;
    constructor(path: string, options?: FileSessionStoreOptions);
    /** Why the last load produced an empty map, when it did. */
    get lastLoadError(): string | undefined;
    /** Why the last write failed, when it did. */
    get lastSaveError(): string | undefined;
    get(conversationId: string): SessionRecord | undefined;
    set(record: SessionRecord): void;
    delete(conversationId: string): void;
    clear(): void;
    entries(): Iterable<[string, SessionRecord]>;
    /** Number of loaded records (forces the lazy load). */
    get size(): number;
    private ensureLoaded;
    /** Accept the documented payload, plus the two shapes a hand-edited file takes. */
    private absorb;
    private absorbRecord;
    private prune;
    private flush;
}
/**
 * Build the registry the adapter uses.
 *
 * @param configuredPath - `config.sessionStorePath`.
 * @param options - clock and retention overrides (tests).
 * @param env - environment used when the configured path is empty.
 */
export declare function createSessionRegistry(configuredPath: string | undefined, options?: FileSessionStoreOptions, env?: DshEnv): {
    registry: SessionRegistry;
    store: SessionStore;
    path: string;
};
//# sourceMappingURL=file-store.d.ts.map