/**
 * Local HTTP surface of the settings card.
 *
 * The card on the Models page lives in the renderer, but the selection it shows
 * and writes belongs to the Node half: this router is the only bridge. Two
 * exact routes under the plugin's own namespace: read the current selection
 * (GET) and write a partial selection (POST).
 *
 * Rules of the surface:
 * - Loopback only. The routes are exact and unauthenticated, so a non-local peer
 *   is rejected before anything is read or written.
 * - Fail closed, never throw: a broken read or write becomes
 *   `{ ok: false, error }`, and a broken carrier (no web server, refused
 *   registration) leaves the plugin otherwise intact.
 * - No secrets in the response. Messages come from `ZcodeError.message`, which
 *   this module keeps free of tokens; anything else is sanitized and bounded.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Exact path of the selection route (GET + POST). */
export declare const ZCODE_STATE_ROUTE_PATH = "/plugins/dsh-zcode-cli/state";
/**
 * Host-side diagnostic route. Loopback-only, read-only, and mounted only when
 * the caller injects a probe: it exists to answer questions only the host
 * process can answer (why the model picker hides this provider, whether the
 * browser half reached `window.__DSH_BOOT__`).
 */
export declare const ZCODE_DIAG_ROUTE_PATH = "/plugins/dsh-zcode-cli/diag";
/** Effort ids the host accepts on this route. Frozen with the card. */
export declare const ZCODE_EFFORTS: readonly ["minimal", "low", "medium", "high", "xhigh", "max"];
/** One effort option as the card renders it. */
export type ZcodeEffortId = typeof ZCODE_EFFORTS[number];
/** Plans the card offers. Transport is always the official CLI subprocess. */
export declare const ZCODE_PLANS: readonly [{
    readonly id: "free";
    readonly label: "免费套餐";
    readonly labelEn: "Free start plan";
}, {
    readonly id: "paid";
    readonly label: "付费套餐";
    readonly labelEn: "Paid coding plan";
}];
/** One plan id. */
export type ZcodePlanId = typeof ZCODE_PLANS[number]['id'];
/** The selection this route reads and writes. */
export interface ZcodeSelection {
    readonly plan: string;
    readonly model: string;
    readonly effort: string;
}
/** A partial write; only the keys present are changed. */
export interface ZcodeSelectionPatch {
    readonly plan?: string;
    readonly model?: string;
    readonly effort?: string;
}
/**
 * Everything {@link createZcodeWebRoutes} touches.
 *
 * `setSelection` is the plugin's own setter (see the handoff): it must persist
 * the selection in the DSH settings namespace, never in a ZCode config file.
 */
export interface ZcodeWebRoutesDeps {
    getConfig(): ZcodeSelection;
    setSelection(patch: ZcodeSelectionPatch): Promise<void>;
    /**
     * Optional host-side probe. The provider row can be correct while the model
     * picker still hides the provider (the host drops a group whose model
     * resolution throws), so the only place that can answer "why" is the host
     * process itself. Absent in production until a caller wires it.
     */
    readonly probe?: () => Promise<unknown>;
}
/** The slice of the host web server this module uses. */
export interface ZcodeWebServerLike {
    register(route: {
        kind: 'exact' | 'prefix';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
    }): () => void;
}
/** The mounted route set. */
export interface ZcodeWebRoutes {
    /** Register the routes on the host carrier; returns a disposer. */
    register(server: ZcodeWebServerLike): () => void;
}
/** The state payload, in the exact shape the card expects. */
export interface ZcodeStatePayload {
    readonly plan: string;
    readonly model: string;
    readonly effort: string;
    readonly plans: readonly {
        readonly id: string;
        readonly label: string;
        readonly labelEn: string;
    }[];
    readonly models: readonly {
        readonly id: string;
        readonly label: string;
    }[];
    readonly efforts: readonly {
        readonly id: string;
        readonly label: string;
    }[];
}
/**
 * Build the settings-page route set.
 *
 * @param deps - selection accessors and an optional host probe.
 * @returns a register/dispose pair; nothing is mounted until `register` runs.
 */
export declare function createZcodeWebRoutes(deps: ZcodeWebRoutesDeps): ZcodeWebRoutes;
//# sourceMappingURL=router.d.ts.map