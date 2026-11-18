/**
 * Session mapping and per-conversation serialization.
 *
 * ZCode's `--resume <sess_…>` reuses a CLI-side session, but the provider has to
 * remember which `sess_…` belongs to which DSH conversation, and it has to stop
 * two requests of the same conversation from racing into the same ZCode session
 * (the CLI keeps one live session per id; a second writer corrupts it).
 *
 * Two layers, deliberately separated:
 *
 * - {@link SessionStore} — a plain `conversationId → SessionRecord` map, with an
 *   in-memory implementation used by tests and by the default (non-persistent)
 *   wiring;
 * - {@link SessionRegistry} — the store plus the per-`conversationId` lock and
 *   the retention policy (age and record count).
 *
 * Persistence is `file-store.ts`'s job; it implements the same interface, so the
 * adapter is written against the interface and knows nothing about the disk.
 */
/** One remembered ZCode session. */
export interface SessionRecord {
    /** ZCode session id, always `sess_…`-shaped. */
    readonly sessionId: string;
    /** DSH conversation this id belongs to. */
    readonly conversationId: string;
    /** Epoch ms of the last write, used for retention. */
    readonly updatedAt: number;
}
/** Minimal durable map the registry needs. Implementations must not throw on read. */
export interface SessionStore {
    get(conversationId: string): SessionRecord | undefined;
    set(record: SessionRecord): void;
    delete(conversationId: string): void;
    clear(): void;
}
/** A store that can also be swept; both implementations here are. */
export interface EnumerableSessionStore extends SessionStore {
    entries(): Iterable<[string, SessionRecord]>;
}
/** Retention defaults; a 2000-entry map of ~90-byte records stays well under 200 KB. */
export declare const SESSION_MAX_RECORDS = 2000;
/** Sessions older than this are dropped: `--resume` against a month-old id is noise. */
export declare const SESSION_MAX_AGE_MS: number;
/** Process-lifetime session map. */
export declare class InMemorySessionStore implements EnumerableSessionStore {
    private readonly records;
    get(conversationId: string): SessionRecord | undefined;
    set(record: SessionRecord): void;
    delete(conversationId: string): void;
    clear(): void;
    entries(): Iterable<[string, SessionRecord]>;
    /** Number of remembered conversations (diagnostics and tests). */
    get size(): number;
}
/** Options of {@link SessionRegistry}. */
export interface SessionRegistryOptions {
    /** Clock override for retention tests. */
    readonly now?: (() => number) | undefined;
    /** Per-conversation retention; defaults to {@link SESSION_MAX_AGE_MS}. */
    readonly maxAgeMs?: number | undefined;
    /** Record-count ceiling; defaults to {@link SESSION_MAX_RECORDS}. */
    readonly maxRecords?: number | undefined;
}
/**
 * Store facade plus the per-conversation lock.
 *
 * The lock is a promise chain per key: `acquire()` waits for the previous holder
 * of *that* key and resolves with its own release function. Different keys never
 * wait for each other, which is what makes two conversations concurrent while
 * one conversation stays strictly serial (AC8).
 */
export declare class SessionRegistry {
    private readonly store;
    private readonly locks;
    private readonly now;
    private readonly maxAgeMs;
    private readonly maxRecords;
    constructor(store?: SessionStore, options?: SessionRegistryOptions);
    /** Remembered record for one conversation, if any and not expired. */
    get(conversationId: string): SessionRecord | undefined;
    /** Remember one conversation's ZCode session. */
    set(conversationId: string, sessionId: string): SessionRecord;
    delete(conversationId: string): void;
    clear(): void;
    /**
     * Take the lock for one conversation.
     *
     * The returned function releases it and is idempotent, so an adapter that
     * releases in both a success path and a `finally` cannot corrupt the chain.
     *
     * @param conversationId - DSH conversation (or a stable stand-in when the
     * runtime supplies no session id).
     * @returns release function; call it exactly once, in `finally`.
     */
    acquire(conversationId: string): Promise<() => void>;
    /** Number of conversations currently holding or waiting for a lock. */
    get pendingLocks(): number;
    private isExpired;
    /**
     * Enforce both retention limits.
     *
     * Called on every write and on load. A store that cannot be enumerated is
     * skipped rather than guessed at, so an exotic implementation degrades to
     * "no pruning" instead of "prunes wrong".
     */
    sweep(): void;
    /** Record-count ceiling, exposed for the file store's own prune. */
    get recordLimit(): number;
    /** Age ceiling, exposed for the file store's own prune. */
    get ageLimitMs(): number;
}
//# sourceMappingURL=store.d.ts.map