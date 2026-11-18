/**
 * Project the live DSH tool registry into MCP tool descriptors.
 *
 * This is the replacement for the old DSH-owned prompt contract: instead of
 * serializing every tool schema into the prompt (58 KB on a stock profile with
 * 18 bundles, which the 56 KiB prompt budget could not hold), the same schemas
 * travel over MCP and cost zero prompt bytes.
 *
 * The schemas are sanitized by `sanitizeSchema` from the structured tool
 * protocol, so MCP exposure and the legacy envelope agree on exactly which
 * JSON Schema keywords are allowed to leave the host.
 */
import { sanitizeSchema, TOOL_PROTOCOL_LIMITS } from '../provider/tool-protocol.js';
/**
 * Tools that must never be projected to ZCode. These are either DSH-internal
 * controls that would let ZCode steer its own host, or tools whose execution
 * requires a DSH agent identity that an MCP-originated call does not carry.
 *
 * Exported so the bridge can tell "dropped on purpose" apart from "dropped by
 * the cap" when it reports what the model is missing.
 */
export const NEVER_PROJECTED_TOOLS = new Set([
    'compress',
    'decompress',
    'search_context',
    'acp_status',
    'acp_cache',
]);
const FALLBACK_SCHEMA = Object.freeze({
    type: 'object',
    properties: {},
    additionalProperties: false,
});
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readSchemaName(value) {
    if (!isRecord(value))
        return undefined;
    const name = value.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
}
/**
 * Project the registry. `listChanged: false` is advertised to ZCode, so the set
 * is snapshotted per request rather than pushed; a profile change simply takes
 * effect on the next turn.
 */
/**
 * Check a call's arguments against the projected schema, mechanically.
 *
 * ZCode does not honour `required` and sometimes sends the wrong primitive
 * (`{"query":123}` for a string field, `{}` for a call that needs one). Left
 * unchecked, every such call still walks the host guard chain and the approval
 * service before the schema layer rejects it — so the bridge answers first, with
 * the same wording the host uses. Anything this function cannot decide
 * (unknown property, no declared type) is left to DSH: a bridge that guesses
 * would be a second, weaker validator pretending to be the real one.
 */
export function validateToolArguments(schema, args) {
    if (!isRecord(schema) || schema.type !== 'object')
        return [];
    const problems = [];
    const given = isRecord(args) ? args : undefined;
    if (given === undefined) {
        return [`arguments must be an object, got ${Array.isArray(args) ? 'array' : typeof args}`];
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
        if (typeof key !== 'string')
            continue;
        if (given[key] === undefined)
            problems.push(`missing required property "${key}"`);
    }
    const properties = isRecord(schema.properties) ? schema.properties : undefined;
    if (properties !== undefined) {
        for (const [key, value] of Object.entries(given)) {
            const declared = properties[key];
            if (!isRecord(declared) || value === undefined || value === null)
                continue;
            const expected = declared.type;
            if (typeof expected !== 'string')
                continue;
            if (!matchesJsonType(value, expected)) {
                problems.push(`"${key}" must be ${expectedDescriptionOf(expected)}, got ${typeof value}`);
            }
        }
    }
    return problems;
}
function matchesJsonType(value, expected) {
    switch (expected) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number';
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value);
        case 'object': return isRecord(value);
        default: return true;
    }
}
function expectedDescriptionOf(expected) {
    switch (expected) {
        case 'integer': return 'an integer';
        case 'array': return 'an array';
        default: return `a ${expected}`;
    }
}
export function projectDshTools(registry, options = {}) {
    const excluded = [];
    const maxTools = options.maxTools ?? TOOL_PROTOCOL_LIMITS.maxTools;
    if (registry === undefined || typeof registry.schemas !== 'function') {
        return { tools: [], excluded };
    }
    let raw;
    try {
        raw = registry.schemas(options.scope) ?? [];
    }
    catch {
        return { tools: [], excluded };
    }
    const allow = options.allowlist === undefined || options.allowlist.length === 0
        ? undefined
        : new Set(options.allowlist);
    const seen = new Set();
    const tools = [];
    for (const entry of raw) {
        const name = readSchemaName(entry);
        if (name === undefined)
            continue;
        if (seen.has(name))
            continue;
        seen.add(name);
        if (NEVER_PROJECTED_TOOLS.has(name)) {
            excluded.push(name);
            continue;
        }
        if (allow !== undefined && !allow.has(name)) {
            excluded.push(name);
            continue;
        }
        if (tools.length >= maxTools) {
            excluded.push(name);
            continue;
        }
        const source = entry;
        let parameters;
        try {
            const sanitized = sanitizeSchema(source.parameters, 0, `tool ${name}.parameters`);
            parameters = isRecord(sanitized) && sanitized.type === 'object' ? sanitized : { ...FALLBACK_SCHEMA };
        }
        catch {
            // An unsupported keyword must not remove a working tool from the model's
            // view; fall back to an open object and let DSH validate the arguments.
            parameters = { ...FALLBACK_SCHEMA };
        }
        const description = typeof source.description === 'string' ? source.description : '';
        tools.push({
            name,
            description: description.length > TOOL_PROTOCOL_LIMITS.maxDescriptionLength
                ? description.slice(0, TOOL_PROTOCOL_LIMITS.maxDescriptionLength)
                : description,
            inputSchema: parameters,
        });
    }
    tools.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return { tools, excluded };
}
//# sourceMappingURL=tool-projection.js.map