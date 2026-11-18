/**
 * Standard-output parser of the ZCode provider.
 *
 * ZCode 0.17.0 prints its answer to stdout when `--json` is passed, and
 * *nothing at all* to stdout when it fails (failures go to stderr as human text
 * — see `error-codes.ts`). What the successful stdout actually looks like is
 * still unproven: the only run that could have shown it returned
 * `providerCode 1309` (Coding Plan expired), so both plausible shapes are
 * supported here and a real sample — once a subscription exists — only tightens
 * the recognizer, it does not change this module's contract:
 *
 * 1. **line-incremental** (NDJSON): each stdout line is one JSON frame, so text
 *    deltas can be yielded while the child is still running;
 * 2. **whole-segment**: the entire stdout is one JSON document (pretty-printed
 *    or not), which only yields a single delta at the end.
 *
 * The one invariant that holds for both shapes, and the reason this module
 * exists at all: **empty or unrecognized stdout is never a success**. A run that
 * produced no text frame and no error frame raises `ZCODE_PARSE` carrying the
 * head of the raw output, so a broken shape surfaces as a provider failure
 * instead of an empty assistant turn.
 *
 * Frame *order* is not decided here. This module yields text/usage/session
 * facts in arrival order; `provider/zcode.ts` owns the `StreamChunk` sequence
 * (`block-start → text-delta* → block-end → usage? → finish`).
 */
import { ZcodeError } from '../provider/error-codes.js';
/** Prefix of a ZCode session id, e.g. `sess_477143eb-6589-4e57-936c-800e3fd975e6`. */
export declare const ZCODE_SESSION_ID_PREFIX = "sess_";
/** How much raw stdout a `ZCODE_PARSE` error keeps for diagnostics. */
export declare const PARSE_PREVIEW_MAX_CHARS = 512;
/**
 * Default ceiling on frames retained per stream.
 *
 * A runaway child can print frames far faster than the turn consumes them; the
 * parser keeps the first and last slice of the stream (the head carries the
 * session id and usage header, the tail carries `finish`/`error`) and counts
 * what it evicted, so memory stays bounded without changing the text total.
 */
export declare const STREAM_MAX_FRAMES = 4096;
/** Frames kept from the head of the stream before the tail window starts. */
export declare const FRAMES_HEAD_KEEP = 256;
/** Token counters as ZCode reports them, before mapping onto `dsh-llm`'s `TokenUsage`. */
export interface ZcodeTokenUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly reasoningTokens?: number;
}
/** A normalized stdout frame. */
export type ZcodeFrame = {
    readonly kind: 'text';
    readonly text: string;
} | {
    readonly kind: 'session';
    readonly sessionId: string;
} | {
    readonly kind: 'usage';
    readonly usage: ZcodeTokenUsage;
} | {
    readonly kind: 'finish';
    readonly stopReason: string | undefined;
} | {
    readonly kind: 'tool';
    readonly toolName: string | undefined;
    readonly request: ZcodeToolRequestKind;
} | {
    readonly kind: 'error';
    readonly error: ZcodeError;
} | {
    readonly kind: 'unknown';
    readonly raw: string;
};
/** What a tool-shaped frame asks for; decides which fail-closed code the adapter raises. */
export type ZcodeToolRequestKind = 'tool-call' | 'permission';
/** First non-empty text carried by one frame, in documented fallback order. */
export declare function frameText(node: Record<string, unknown>): string | undefined;
/** First `sess_…`-shaped id carried by one frame, in documented fallback order. */
export declare function frameSessionId(node: Record<string, unknown>): string | undefined;
/**
 * Read token counters off one frame.
 *
 * Both naming conventions are accepted (`input_tokens` / `inputTokens`, and the
 * OpenAI-style `prompt_tokens` / `completion_tokens`): ZCode proxies several
 * upstream providers, and a counter that is silently dropped would show up as
 * zero usage in the DSH transcript.
 */
export declare function frameUsage(node: Record<string, unknown>): ZcodeTokenUsage | undefined;
/**
 * Classify one already-parsed JSON value into normalized frames.
 *
 * A JSON *array* is treated as a batch of frames, which is the shape a
 * transcript dump would have; every other value is one frame.
 */
export declare function classifyJsonValue(value: unknown): ZcodeFrame[];
/** Aggregate view of one complete stdout capture. */
export interface ZcodeParseResult {
    /** How the capture was understood; the caller only logs this. */
    readonly mode: 'ndjson' | 'single-json' | 'whole-json';
    /** Every recognized frame, in arrival order. */
    readonly frames: readonly ZcodeFrame[];
    /** Text deltas in arrival order (the assistant answer, piecewise). */
    readonly deltas: readonly string[];
    /** Concatenated deltas. */
    readonly text: string;
    /** Session id observed on stdout, when ZCode printed one. */
    readonly sessionId: string | undefined;
    /** Last usage frame, when ZCode reported counters. */
    readonly usage: ZcodeTokenUsage | undefined;
    /** Provider stop reason, when reported. */
    readonly stopReason: string | undefined;
    /** Tool-shaped frames; non-empty means the run must be failed closed. */
    readonly toolRequests: readonly ZcodeFrame[];
    /** In-band error frame, when the stream carried one. */
    readonly failure: ZcodeError | undefined;
    /** Lines that were neither JSON nor recognizable. */
    readonly unknownLines: number;
}
/**
 * Line-incremental parser.
 *
 * Feed raw stdout chunks with {@link pushChunk} (the process layer already
 * splits lines, so {@link pushLine} is the normal entry point) and collect the
 * frames of every complete line. A trailing line without a newline is held back
 * until {@link flush}, because half a JSON frame must never be classified.
 */
export declare class ZcodeStreamParser {
    private buffer;
    private textChars;
    private readonly head;
    private readonly tail;
    private dropped;
    private readonly maxFrames;
    private rawHead;
    constructor(maxFrames?: number);
    /** Bytes-worth of raw stdout retained for `ZCODE_PARSE` diagnostics. */
    get rawPreview(): string;
    /** Total visible text characters parsed so far. */
    get textLength(): number;
    /** Frames parsed so far, in arrival order (bounded by {@link STREAM_MAX_FRAMES}). */
    get frames(): readonly ZcodeFrame[];
    /** Total frames seen, including the ones evicted from the retention window. */
    get frameCount(): number;
    /** Frames evicted from the retention window (diagnostics only). */
    get droppedFrameCount(): number;
    /** Feed one complete stdout line (no trailing newline). */
    pushLine(line: string): ZcodeFrame[];
    /** Feed an arbitrary stdout chunk, emitting the frames of every complete line. */
    pushChunk(chunk: string): ZcodeFrame[];
    /** Flush a trailing line that never got its newline. */
    flush(): ZcodeFrame[];
    private classifyLine;
    private absorb;
}
/**
 * Parse a complete stdout capture.
 *
 * Order of attempts: line-incremental (NDJSON), then whole-segment JSON, then
 * failure. Never returns an empty success: a capture with no text frame and no
 * error frame raises `ZCODE_PARSE` carrying the head of the raw output.
 *
 * @param stdout - the child's complete stdout.
 * @throws ZcodeError `ZCODE_PARSE` when no usable frame was found.
 */
export declare function parseStdout(stdout: string): ZcodeParseResult;
//# sourceMappingURL=parser.d.ts.map