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
function isEnumerable(store) {
    return typeof store.entries === 'function';
}
/** Retention defaults; a 2000-entry map of ~90-byte records stays well under 200 KB. */
export const SESSION_MAX_RECORDS = 2_000;
/** Sessions older than this are dropped: `--resume` against a month-old id is noise. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
/** Process-lifetime session map. */
export class InMemorySessionStore {
    records = new Map();
    get(conversationId) {
        return this.records.get(conversationId);
    }
    set(record) {
        this.records.set(record.conversationId, record);
    }
    delete(conversationId) {
        this.records.delete(conversationId);
    }
    clear() {
        this.records.clear();
    }
    entries() {
        return this.records.entries();
    }
    /** Number of remembered conversations (diagnostics and tests). */
    get size() {
        return this.records.size;
    }
}
/**
 * Store facade plus the per-conversation lock.
 *
 * The lock is a promise chain per key: `acquire()` waits for the previous holder
 * of *that* key and resolves with its own release function. Different keys never
 * wait for each other, which is what makes two conversations concurrent while
 * one conversation stays strictly serial (AC8).
 */
export class SessionRegistry {
    store;
    locks = new Map();
    now;
    maxAgeMs;
    maxRecords;
    constructor(store = new InMemorySessionStore(), options = {}) {
        this.store = store;
        this.now = options.now ?? (() => Date.now());
        this.maxAgeMs = options.maxAgeMs ?? SESSION_MAX_AGE_MS;
        this.maxRecords = options.maxRecords ?? SESSION_MAX_RECORDS;
    }
    /** Remembered record for one conversation, if any and not expired. */
    get(conversationId) {
        const record = this.store.get(conversationId);
        if (record === undefined)
            return undefined;
        if (this.isExpired(record)) {
            this.store.delete(conversationId);
            return undefined;
        }
        return record;
    }
    /** Remember one conversation's ZCode session. */
    set(conversationId, sessionId) {
        const record = { sessionId, conversationId, updatedAt: this.now() };
        this.store.set(record);
        this.sweep();
        return record;
    }
    delete(conversationId) {
        this.store.delete(conversationId);
    }
    clear() {
        this.store.clear();
    }
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
    async acquire(conversationId) {
        const previous = this.locks.get(conversationId) ?? Promise.resolve();
        let release;
        const gate = new Promise(resolve => {
            release = resolve;
        });
        const tail = previous.then(() => gate);
        this.locks.set(conversationId, tail);
        // Drop the entry once this holder is done and nobody else queued behind it,
        // so a long-lived host does not accumulate one settled promise per
        // conversation it has ever served.
        void tail.then(() => {
            if (this.locks.get(conversationId) === tail)
                this.locks.delete(conversationId);
        });
        await previous;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            release();
        };
    }
    /** Number of conversations currently holding or waiting for a lock. */
    get pendingLocks() {
        return this.locks.size;
    }
    isExpired(record) {
        return this.now() - record.updatedAt > this.maxAgeMs;
    }
    /**
     * Enforce both retention limits.
     *
     * Called on every write and on load. A store that cannot be enumerated is
     * skipped rather than guessed at, so an exotic implementation degrades to
     * "no pruning" instead of "prunes wrong".
     */
    sweep() {
        if (!isEnumerable(this.store))
            return;
        const kept = [];
        for (const [, record] of this.store.entries()) {
            if (!this.isExpired(record))
                kept.push(record);
        }
        kept.sort((left, right) => right.updatedAt - left.updatedAt);
        for (const record of kept.slice(this.maxRecords))
            this.store.delete(record.conversationId);
    }
    /** Record-count ceiling, exposed for the file store's own prune. */
    get recordLimit() {
        return this.maxRecords;
    }
    /** Age ceiling, exposed for the file store's own prune. */
    get ageLimitMs() {
        return this.maxAgeMs;
    }
}
//# sourceMappingURL=store.js.map