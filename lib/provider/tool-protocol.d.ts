/**
 * The schema half of the DSH tool protocol.
 *
 * Narrowed deliberately: a structured-prompt adapter needs the whole protocol
 * (envelope rendering, argument matching, response parsing), while the ZCode
 * bridge only needs to put a DSH tool schema on an MCP wire. So this file
 * carries exactly two things — the shared size limits and the schema
 * whitelist that decides which JSON Schema keywords are allowed through — and
 * nothing about prompts.
 *
 * The whitelist exists because MCP servers receive a client-supplied schema
 * verbatim: an unrestricted one is both a smuggling channel (`__proto__` keys
 * reach an object merge inside the host) and an unbounded token cost.
 */
/** Upper bounds for the provider-side structured tool protocol. */
export declare const TOOL_PROTOCOL_LIMITS: Readonly<{
    maxTools: 256;
    maxToolNameLength: 128;
    maxDescriptionLength: 4096;
    maxSchemaDepth: 10;
    maxSchemaBytes: number;
    maxArgumentsBytes: number;
    maxMessageLength: number;
    maxResultBytes: number;
}>;
export declare const TOOL_PROTOCOL_SCHEMA_INVALID_CODE: "TOOL_PROTOCOL_SCHEMA_INVALID";
export declare const TOOL_PROTOCOL_SCHEMA_LIMIT_CODE: "TOOL_PROTOCOL_SCHEMA_LIMIT";
export type ToolProtocolErrorCode = typeof TOOL_PROTOCOL_SCHEMA_INVALID_CODE | typeof TOOL_PROTOCOL_SCHEMA_LIMIT_CODE;
/** Stable error that never embeds raw prompts, arguments, schemas, or paths. */
export declare class ToolProtocolError extends Error {
    readonly code: ToolProtocolErrorCode;
    readonly detail: string | undefined;
    constructor(code: ToolProtocolErrorCode, detail?: string);
}
/**
 * Whitelist one JSON Schema down to the keywords the DSH tool protocol
 * supports. Shared with the MCP tool projection so one gate decides what a
 * model ever sees, instead of two policies drifting apart.
 */
export declare function sanitizeSchema(value: unknown, depth: number, label: string): unknown;
//# sourceMappingURL=tool-protocol.d.ts.map