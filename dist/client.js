window.__ModuleLoader__.load({ id: "dsh-zcode-cli", factory: (require) => {
var __modules = Object.create(null);
var __require = (specifier) => {
  if (specifier in __modules) {
    const inner = __modules[specifier];
    inner(__require, inner.exports ??= {}, inner);
    return inner.exports;
  }
  return require(specifier);
};
__modules["client/locales.js"] = function (require, exports, module) {
"use strict";
/**
 * Locale dictionaries for the ZCode provider card.
 *
 * `NS` is the *locale* namespace the card registers its strings under. It is
 * deliberately the same string as `ZCODE_SETTINGS_NS` in `src/index.ts`, but
 * the two are separate contracts: the slot key (what the host matches the
 * provider row by) is `SETTINGS_NS` in `client/index.ts`, this one only names
 * the dictionary. Keeping them equal is a convenience, not the requirement.
 *
 * Simplified Chinese is the key source; `en` must be a complete dictionary or
 * `tsc -p tsconfig.client.json` fails.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.en = exports.zh = exports.NS = void 0;
exports.NS = 'dsh-zcode-cli';
exports.zh = {
    'card.title': 'ZCode CLI',
    'card.badge.on': '已在目录中',
    'card.badge.off': '未在目录中',
    'card.badge.unknown': '状态未知',
    'card.route': '提供方路由',
    'card.ns': '设置命名空间',
    'card.models': '模型目录',
    'card.models.catalog': '目录',
    'card.models.default': '默认',
    'card.defaults': '当前取值',
    'card.defaults.model': '默认模型',
    'card.defaults.sessionMode': '会话模式',
    'card.defaults.sessionMode.value': 'full（每轮重放完整历史；resume 复用 ZCode 会话 id，未验证）',
    'card.defaults.toolPolicy': '工具归属策略',
    'card.defaults.toolPolicy.value': 'dsh-owned（下发 DSH 工具 schema 并投影 tool call）',
    'card.defaults.mode': 'CLI 权限模式',
    'card.defaults.mode.value': 'guarded（固定；yolo 在配置里不可达）',
    'card.defaults.imageInput': '图片输入',
    'card.defaults.imageInput.value': 'off（0.17.0 无已验证的图片传输）',
    'card.defaults.source': '以上是插件内置默认值。宿主卡片槽只下发 provider / configured / keyConfigured，不下发配置本身；真实生效值以「编辑」表单里保存的为准。',
    'card.cli': 'CLI 入口',
    'card.cli.node': 'Node 可执行文件',
    'card.cli.cjs': 'ZCode 入口脚本',
    'card.env': '环境契约',
    'card.env.hint': '由启动 DSH 宿主的进程提供。缺值或值不对时，插件在 spawn 之前就 fail-closed 拒绝，不会静默降级。NODE_OPTIONS 是唯一一项由插件自己补齐的（两个 DNS 旗标）。',
    'card.env.ZCODE_HOME': 'ZCode 引导根目录（缺失时 CLI 起不来）',
    'card.env.ZCODE_DATA_BASE_DIR': 'ZCODE_HOME 的父目录（同一引导步骤要用）',
    'card.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE': '内置 provider 配置（缺失时 CLI 约 714 ms 内退出）',
    'card.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE': '个人 provider 配置（与内置那份必须成对提供）',
    'card.env.NODE_OPTIONS': 'IPv4 优先 DNS；值级白名单，只接受这两个旗标',
    'card.fold.expandAll': '全部展开',
    'card.fold.collapseAll': '全部收起',
    'card.run.title': '运行配置',
    'card.run.plan': '套餐',
    'card.run.model': '模型',
    'card.run.effort': '推理强度',
    'card.run.note': '改动即时保存，下一轮对话生效。两个套餐各有独立额度：免费套餐是 ZCode Start Plan，付费套餐是智谱 Coding Plan（当前已到期）。',
    'card.run.loading': '读取运行配置…',
    'card.run.failed': '读取运行配置失败',
};
exports.en = {
    'card.title': 'ZCode CLI',
    'card.badge.on': 'In the directory',
    'card.badge.off': 'Not in the directory',
    'card.badge.unknown': 'State unknown',
    'card.route': 'Provider route',
    'card.ns': 'Settings namespace',
    'card.models': 'Model catalog',
    'card.models.catalog': 'Catalog',
    'card.models.default': 'default',
    'card.defaults': 'Current values',
    'card.defaults.model': 'Default model',
    'card.defaults.sessionMode': 'Session mode',
    'card.defaults.sessionMode.value': 'full (replays the whole history each turn; resume reuses a ZCode session id and is unverified)',
    'card.defaults.toolPolicy': 'Tool policy',
    'card.defaults.toolPolicy.value': 'dsh-owned (DSH tool schemas are sent and calls are projected)',
    'card.defaults.mode': 'CLI permission mode',
    'card.defaults.mode.value': 'guarded (fixed; yolo is unreachable through config)',
    'card.defaults.imageInput': 'Image input',
    'card.defaults.imageInput.value': 'off (0.17.0 has no verified image transport)',
    'card.defaults.source': 'These are the plugin defaults. The host card slot passes only provider / configured / keyConfigured — never the config itself — so the value actually in effect is the one saved in the Edit form.',
    'card.cli': 'CLI entry points',
    'card.cli.node': 'Node executable',
    'card.cli.cjs': 'ZCode entry script',
    'card.env': 'Environment contract',
    'card.env.hint': 'Supplied by whatever launches the DSH host. A missing or wrong value is refused fail-closed before a child process exists; nothing degrades silently. NODE_OPTIONS is the only entry the provider completes itself (two DNS flags).',
    'card.env.ZCODE_HOME': 'ZCode bootstrap root (the CLI will not start without it)',
    'card.env.ZCODE_DATA_BASE_DIR': 'Parent of ZCODE_HOME (the same bootstrap step needs it)',
    'card.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE': 'Built-in provider config (when missing the CLI exits within ~714 ms)',
    'card.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE': 'Personal provider config (must be supplied together with the built-in one)',
    'card.env.NODE_OPTIONS': 'IPv4-first DNS; value-level allowlist, only these two flags pass',
    'card.fold.expandAll': 'Expand all',
    'card.fold.collapseAll': 'Collapse all',
    'card.run.title': 'Run configuration',
    'card.run.plan': 'Plan',
    'card.run.model': 'Model',
    'card.run.effort': 'Reasoning effort',
    'card.run.note': 'Saved immediately; takes effect on the next turn. Each plan has its own quota: the free plan is the ZCode Start Plan, the paid plan is the Zhipu Coding Plan (expired right now).',
    'card.run.loading': 'Reading the run configuration…',
    'card.run.failed': 'Could not read the run configuration',
};
};
__modules["client/styles.js"] = function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZC_CSS = void 0;
/**
 * Card stylesheet. Every class carries the `zc-` prefix so nothing can leak
 * into the host's own settings UI, and every colour resolves through the
 * `--zc-*` variables below so the card tracks light and dark themes.
 *
 * Injected by the card as a single <style> node.
 */
exports.ZC_CSS = `
@keyframes zc-spin {
	0% { transform: rotate(0deg); }
	100% { transform: rotate(360deg); }
}

:root, body {
	--zc-font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif);
	--zc-bg-panel: var(--dsw-alias-bg-layer-2, #ffffff);
	--zc-bg-card: var(--dsw-alias-bg-layer-2, #ffffff);
	--zc-bg-card-primary: #f0f7ff;
	--zc-bg-header: var(--dsw-alias-bg-layer-1, #f8fafc);
	--zc-bg-box: var(--dsw-alias-bg-layer-1, #f8fafc);
	--zc-bg-subbox: var(--dsw-alias-bg-layer-3, #f1f5f9);
	--zc-bg-input: var(--dsw-alias-bg-layer-1, #ffffff);
	--zc-bg-btn: var(--dsw-alias-bg-layer-3, #f1f5f9);
	--zc-bg-btn-hover: var(--dsw-alias-interactive-bg-hover, #e2e8f0);
	--zc-bg-btn-primary: var(--dsw-alias-state-business-primary, #2563eb);
	--zc-bg-progress-track: #e2e8f0;

	--zc-border-card: var(--dsw-alias-border-l2, #e2e8f0);
	--zc-border-card-primary: #3b82f6;
	--zc-border-box: var(--dsw-alias-border-l1, #e2e8f0);
	--zc-border-subbox: var(--dsw-alias-border-l2, #cbd5e1);
	--zc-border-input: var(--dsw-alias-border-l2, #cbd5e1);
	--zc-border-input-focus: var(--dsw-alias-state-business-primary, #2563eb);
	--zc-border-btn: var(--dsw-alias-border-l2, #cbd5e1);
	--zc-border-btn-primary: #2563eb;
	--zc-border-divider: var(--dsw-alias-border-l2, #e2e8f0);

	--zc-text-primary: var(--dsw-alias-label-primary, #0f172a);
	--zc-text-secondary: var(--dsw-alias-label-secondary, #334155);
	--zc-text-tertiary: var(--dsw-alias-label-tertiary, #64748b);
	--zc-text-muted: var(--dsw-alias-label-caption, #94a3b8);
	--zc-text-btn: var(--dsw-alias-label-primary, #0f172a);
	--zc-text-btn-primary: #ffffff;
	--zc-text-window-label: #2563eb;

	--zc-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.05);
	--zc-shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.08);
	--zc-shadow-card-primary: 0 0 0 1px #3b82f6, 0 4px 14px rgba(37, 99, 235, 0.12);

	/* Badges */
	--zc-badge-primary-bg: #dbeafe;
	--zc-badge-primary-text: #1e40af;
	--zc-badge-primary-border: #60a5fa;

	--zc-badge-tag-bg: #f1f5f9;
	--zc-badge-tag-text: #334155;
	--zc-badge-tag-border: #cbd5e1;

	--zc-badge-email-bg: #eff6ff;
	--zc-badge-email-text: #1d4ed8;
	--zc-badge-email-border: #bfdbfe;

	--zc-badge-proxy-bg: #ecfdf5;
	--zc-badge-proxy-text: #047857;
	--zc-badge-proxy-border: #a7f3d0;

	--zc-badge-ready-bg: #ecfdf5;
	--zc-badge-ready-text: #047857;
	--zc-badge-ready-border: #a7f3d0;

	--zc-badge-unready-bg: #eff6ff;
	--zc-badge-unready-text: #1d4ed8;
	--zc-badge-unready-border: #bfdbfe;

	/* Quota status pills */
	--zc-quota-high-bg: #ecfdf5;
	--zc-quota-high-text: #047857;
	--zc-quota-high-border: #a7f3d0;
	--zc-quota-med-bg: #fffbeb;
	--zc-quota-med-text: #b45309;
	--zc-quota-med-border: #fde68a;
	--zc-quota-low-bg: #fef2f2;
	--zc-quota-low-text: #b91c1c;
	--zc-quota-low-border: #fecaca;
	--zc-quota-none-bg: #f1f5f9;
	--zc-quota-none-text: #64748b;
	--zc-quota-none-border: #cbd5e1;

	/* Danger button */
	--zc-danger-bg: #fef2f2;
	--zc-danger-text: #b91c1c;
	--zc-danger-border: #fecaca;
	--zc-danger-hover-bg: #fee2e2;

	/* Warning banner */
	--zc-warn-bg: #fffbeb;
	--zc-warn-text: #92400e;
	--zc-warn-border: #fcd34d;
	--zc-warn-btn-bg: #fef3c7;
	--zc-warn-btn-text: #92400e;
	--zc-warn-btn-border: #f59e0b;

	/* Toast notices */
	--zc-toast-success-bg: #ecfdf5;
	--zc-toast-success-text: #065f46;
	--zc-toast-success-border: #6ee7b7;
	--zc-toast-info-bg: #eff6ff;
	--zc-toast-info-text: #1e40af;
	--zc-toast-info-border: #93c5fd;
	--zc-toast-warn-bg: #fffbeb;
	--zc-toast-warn-text: #92400e;
	--zc-toast-warn-border: #fcd34d;
	--zc-toast-error-bg: #fef2f2;
	--zc-toast-error-text: #991b1b;
	--zc-toast-error-border: #fca5a5;

	/* Segment control */
	--zc-seg-group-bg: #e2e8f0;
	--zc-seg-group-border: #cbd5e1;
	--zc-seg-btn-text: #475569;
	--zc-seg-btn-active-bg: var(--dsw-alias-state-business-primary, #2563eb);
	--zc-seg-btn-active-text: #ffffff;
	--zc-seg-danger-bg: #dc2626;
	--zc-seg-danger-text: #ffffff;
	--zc-seg-danger-border: #b91c1c;
}

body[data-ds-dark-theme],
body.dark,
[data-theme="dark"] {
	--zc-bg-panel: var(--dsw-alias-bg-layer-2, #0f172a);
	--zc-bg-card: var(--dsw-alias-bg-layer-2, #1e293b);
	--zc-bg-card-primary: #111d33;
	--zc-bg-header: var(--dsw-alias-bg-layer-1, #1e293b);
	--zc-bg-box: var(--dsw-alias-bg-layer-1, #0f172a);
	--zc-bg-subbox: var(--dsw-alias-bg-layer-3, #090d16);
	--zc-bg-input: var(--dsw-alias-bg-layer-3, #090d16);
	--zc-bg-btn: var(--dsw-alias-bg-layer-3, #334155);
	--zc-bg-btn-hover: var(--dsw-alias-interactive-bg-hover, #475569);
	--zc-bg-btn-primary: var(--dsw-alias-state-business-primary, #2563eb);
	--zc-bg-progress-track: #1e293b;

	--zc-border-card: var(--dsw-alias-border-l2, #334155);
	--zc-border-card-primary: #3b82f6;
	--zc-border-box: var(--dsw-alias-border-l1, #1e293b);
	--zc-border-subbox: var(--dsw-alias-border-l2, #334155);
	--zc-border-input: var(--dsw-alias-border-l2, #334155);
	--zc-border-input-focus: #3b82f6;
	--zc-border-btn: var(--dsw-alias-border-l2, #475569);
	--zc-border-btn-primary: #3b82f6;
	--zc-border-divider: var(--dsw-alias-border-l2, #334155);

	--zc-text-primary: var(--dsw-alias-label-primary, #f8fafc);
	--zc-text-secondary: var(--dsw-alias-label-secondary, #cbd5e1);
	--zc-text-tertiary: var(--dsw-alias-label-tertiary, #94a3b8);
	--zc-text-muted: var(--dsw-alias-label-caption, #64748b);
	--zc-text-btn: var(--dsw-alias-label-primary, #ffffff);
	--zc-text-btn-primary: #ffffff;
	--zc-text-window-label: #93c5fd;

	--zc-shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
	--zc-shadow-card-hover: 0 6px 16px rgba(0, 0, 0, 0.4);
	--zc-shadow-card-primary: 0 0 16px rgba(59, 130, 246, 0.25);

	/* Badges */
	--zc-badge-primary-bg: #1e3a8a;
	--zc-badge-primary-text: #93c5fd;
	--zc-badge-primary-border: #3b82f6;

	--zc-badge-tag-bg: #0f172a;
	--zc-badge-tag-text: #cbd5e1;
	--zc-badge-tag-border: #334155;

	--zc-badge-email-bg: #1e293b;
	--zc-badge-email-text: #93c5fd;
	--zc-badge-email-border: #3b82f6;

	--zc-badge-proxy-bg: #064e3b;
	--zc-badge-proxy-text: #6ee7b7;
	--zc-badge-proxy-border: #059669;

	--zc-badge-ready-bg: rgba(16, 185, 129, 0.15);
	--zc-badge-ready-text: #34d399;
	--zc-badge-ready-border: rgba(16, 185, 129, 0.35);

	--zc-badge-unready-bg: rgba(59, 130, 246, 0.15);
	--zc-badge-unready-text: #93c5fd;
	--zc-badge-unready-border: rgba(59, 130, 246, 0.35);

	/* Quota status pills */
	--zc-quota-high-bg: #064e3b;
	--zc-quota-high-text: #6ee7b7;
	--zc-quota-high-border: #059669;
	--zc-quota-med-bg: #451a03;
	--zc-quota-med-text: #fde68a;
	--zc-quota-med-border: #d97706;
	--zc-quota-low-bg: #450a0a;
	--zc-quota-low-text: #fca5a5;
	--zc-quota-low-border: #dc2626;
	--zc-quota-none-bg: #1e293b;
	--zc-quota-none-text: #94a3b8;
	--zc-quota-none-border: #475569;

	/* Danger button */
	--zc-danger-bg: #450a0a;
	--zc-danger-text: #fca5a5;
	--zc-danger-border: #ef4444;
	--zc-danger-hover-bg: #5f1313;

	/* Warning banner */
	--zc-warn-bg: #451a03;
	--zc-warn-text: #fde68a;
	--zc-warn-border: #d97706;
	--zc-warn-btn-bg: #78350f;
	--zc-warn-btn-text: #fde68a;
	--zc-warn-btn-border: #d97706;

	/* Toast notices */
	--zc-toast-success-bg: #064e3b;
	--zc-toast-success-text: #6ee7b7;
	--zc-toast-success-border: #059669;
	--zc-toast-info-bg: #1e3a8a;
	--zc-toast-info-text: #93c5fd;
	--zc-toast-info-border: #3b82f6;
	--zc-toast-warn-bg: #451a03;
	--zc-toast-warn-text: #fde68a;
	--zc-toast-warn-border: #d97706;
	--zc-toast-error-bg: #450a0a;
	--zc-toast-error-text: #fca5a5;
	--zc-toast-error-border: #dc2626;

	/* Segment control */
	--zc-seg-group-bg: #090d16;
	--zc-seg-group-border: #334155;
	--zc-seg-btn-text: #94a3b8;
	--zc-seg-btn-active-bg: var(--dsw-alias-state-business-primary, #2563eb);
	--zc-seg-btn-active-text: #ffffff;
	--zc-seg-danger-bg: #7f1d1d;
	--zc-seg-danger-text: #fca5a5;
	--zc-seg-danger-border: #ef4444;
}

.zc-spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border: 2px solid currentColor;
	border-top-color: transparent;
	border-radius: 50%;
	animation: zc-spin 0.75s linear infinite;
	vertical-align: -2px;
	margin-right: 5px;
}
.zc-pulse-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
}
.zc-card-hover {
	transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease;
}
.zc-card-hover:hover {
	border-color: var(--zc-border-card-primary, #3b82f6) !important;
	box-shadow: var(--zc-shadow-card-hover) !important;
}
.zc-btn {
	transition: all 0.15s ease;
	user-select: none;
}
.zc-btn:hover:not(:disabled) {
	filter: brightness(1.08);
	transform: translateY(-0.5px);
}
.zc-btn:active:not(:disabled) {
	transform: translateY(0.5px);
}
.zc-progress-fill {
	transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.zc-submodel-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 7px 10px;
	font-size: 11.5px;
	border-radius: 6px;
	background: var(--zc-bg-subbox);
	border: 1px solid var(--zc-border-box);
	margin: 4px 0;
	color: var(--zc-text-primary);
}
.zc-select {
	appearance: none;
	-webkit-appearance: none;
	font: inherit;
	font-size: 11.5px;
	font-weight: 600;
	color: var(--zc-text-primary);
	background-color: var(--zc-bg-subbox);
	border: 1px solid var(--zc-border-box);
	border-radius: 6px;
	padding: 4px 20px 4px 8px;
	max-width: 190px;
	cursor: pointer;
	background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
	background-position: calc(100% - 11px) calc(50% + 1px), calc(100% - 7px) calc(50% + 1px);
	background-size: 4px 4px, 4px 4px;
	background-repeat: no-repeat;
}
.zc-select:hover:not(:disabled) {
	border-color: var(--zc-border-box);
	filter: brightness(1.05);
}
.zc-select:disabled {
	opacity: 0.55;
	cursor: default;
}
.zc-checklist {
	display: flex;
	flex-wrap: wrap;
	gap: 3px 14px;
	max-height: 112px;
	overflow-y: auto;
	padding: 6px 8px;
	border-radius: 6px;
	background: var(--zc-bg-subbox);
	border: 1px solid var(--zc-border-box);
}
.zc-check-item {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	font-size: 11.5px;
	color: var(--zc-text-primary);
	cursor: pointer;
	white-space: nowrap;
}
.zc-check-item input {
	cursor: pointer;
	margin: 0;
}
.zc-fold-group {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.zc-fold-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.zc-fold-switch {
	margin-left: auto;
	font: inherit;
	font-size: 11.5px;
	line-height: 1.4;
	padding: 2px 8px;
	border-radius: 5px;
	cursor: pointer;
	color: var(--zc-text-secondary);
	background: var(--zc-bg-btn);
	border: 1px solid var(--zc-border-btn);
}
.zc-fold-switch:hover {
	background: var(--zc-bg-btn-hover);
}
/* The label follows the group, not a click counter: once every block is open
   the switch offers "collapse all", otherwise "expand all". A block opened by
   hand can therefore never leave a lying label behind. */
.zc-fold-switch > .zc-fold-collapse {
	display: none;
}
.zc-fold-group:not(:has(> details.zc-fold:not([open]))) > .zc-fold-bar .zc-fold-expand {
	display: none;
}
.zc-fold-group:not(:has(> details.zc-fold:not([open]))) > .zc-fold-bar .zc-fold-collapse {
	display: inline;
}
.zc-fold {
	border: 1px solid var(--zc-border-box);
	border-radius: 6px;
	background: var(--zc-bg-subbox);
}
.zc-fold > summary {
	cursor: pointer;
	list-style: none;
	user-select: none;
	font-weight: 600;
	font-size: 12px;
	opacity: 0.85;
	padding: 5px 9px;
	display: flex;
	align-items: center;
	gap: 6px;
}
.zc-fold > summary::-webkit-details-marker {
	display: none;
}
.zc-fold > summary::before {
	content: '▸';
	display: inline-block;
	font-size: 10px;
	transition: transform 0.15s ease;
}
.zc-fold[open] > summary::before {
	transform: rotate(90deg);
}
.zc-fold > summary:hover {
	opacity: 1;
}
.zc-fold-body {
	display: flex;
	flex-direction: column;
	gap: 3px;
	padding: 2px 9px 7px;
}
`;
};
__modules["client/index.js"] = function (require, exports, module) {
"use strict";
/**
 * Browser half of the ZCode provider: the card the host renders inside the
 * provider row on 设置 → 模型.
 *
 * Why it exists: the Node half registers the directory entry
 * (`ctx.llm.registerConfigurableProviders`, `settingsNs: 'dsh-zcode-cli'`
 * in `src/index.ts`), and the host then renders that row's body by dispatching
 * the keyed slot `settings.models.provider-card` for the entry whose registered
 * `key` equals the row's `settingsNs` **verbatim**. With no client half there is
 * no entry under that key, and the host does not fall back to a generic form —
 * the row body stays empty. This file is that entry.
 *
 * Scope: a run-configuration block (plan, model, reasoning effort) plus a
 * read-only information panel. The run-configuration block reads and writes the
 * plugin's own loopback route (`GET`/`POST /plugins/dsh-zcode-cli/state`,
 * mounted by `src/web/router.ts`). Everything below the divider is a
 * compile-time mirror of the Node half or a value read out of the
 * slot props the host does pass — `{ provider, configured, keyConfigured }`
 * (app.asar ModelsSection, `renderSlot('settings.models.provider-card',
 * {provider, configured, keyConfigured}, {entryKey})`). Nothing here can throw
 * on a missing prop: the host wraps each slot entry in `SlotErrorBoundary`,
 * which renders an empty element on a throw — a card that crashes looks exactly
 * like the empty row this file is fixing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.apply = apply;
const locales_js_1 = require("client/locales.js");
const styles_js_1 = require("client/styles.js");
const R = require('react');
const { createElement: h, useState, useEffect } = R;
exports.name = 'dsh-zcode-cli-client';
/**
 * Cordis `inject` entries are hard dependencies: touching a service that is not
 * listed throws. `locale` is declared because `apply` reads `ctx.locale`; the
 * locales themselves are registered below, so the card never renders a raw key.
 */
exports.inject = ['slots', 'locale'];
// ── Mirrored facts from the Node half ──────────────────────────────────────
// These are literals on purpose. Importing `src/provider/config.ts` would drag
// `@deepseek-ai/schemastery` and the adapter's whole module graph into the
// browser bundle, where a missing host module throws at load time and the card
// blanks out. `tests/client.test.mjs` pins every literal below to the source it
// mirrors, so drift fails the gate instead of quietly lying on the settings page.
/** MUST equal `ZCODE_SETTINGS_NS` in `src/index.ts`; this is the slot key. */
const SETTINGS_NS = 'dsh-zcode-cli';
/** MUST equal `ZCODE_PROVIDER_ROUTE` in `src/index.ts`. */
const PROVIDER_ROUTE = 'zcode';
/** Slot registration id; unique per card, not a contract with the host. */
const CARD_ID = 'zcode-provider-card';
/** MUST equal `DEFAULT_MODEL` in `src/provider/config.ts`. */
const DEFAULT_MODEL = 'GLM-5.3-Flash';
/** MUST equal the ids of `DEFAULT_MODELS` in `src/provider/config.ts`. */
const MODELS = ['GLM-5.3-Flash', 'GLM-5.3'];
/** MUST equal `DEFAULT_NODE_PATH` / `DEFAULT_ZCODE_CJS_PATH` in `src/provider/config.ts`. */
const NODE_PATH = 'D:\\nodejs\\node.exe';
const ZCODE_CJS_PATH = 'F:\\AgentData\\zcode\\cli\\resources\\glm\\zcode.cjs';
/** MUST equal `ZCODE_STATE_ROUTE_PATH` in `src/web/router.ts`. */
const STATE_PATH = '/plugins/dsh-zcode-cli/state';
/**
 * MUST equal `ZCODE_ENV_CONTRACT` in `src/zcode/process.ts` (names and expected
 * values; `NODE_OPTIONS` is listed with the flags the provider contributes).
 */
const ENV_CONTRACT = [
    {
        name: 'ZCODE_HOME',
        expected: 'F:\\AgentData\\zcode\\data\\.zcode',
        descriptionKey: 'card.env.ZCODE_HOME',
    },
    {
        name: 'ZCODE_DATA_BASE_DIR',
        expected: 'F:\\AgentData\\zcode\\data',
        descriptionKey: 'card.env.ZCODE_DATA_BASE_DIR',
    },
    {
        name: 'ZCODE_BUILTIN_PROVIDER_CONFIG_FILE',
        expected: 'F:\\AgentData\\zcode\\cli\\resources\\config\\provider\\zcode-builtin.json',
        descriptionKey: 'card.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE',
    },
    {
        name: 'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE',
        expected: 'F:\\AgentData\\zcode\\data\\.zcode\\v2\\provider_config.json',
        descriptionKey: 'card.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE',
    },
    {
        name: 'NODE_OPTIONS',
        expected: '--no-network-family-autoselection --dns-result-order=ipv4first',
        descriptionKey: 'card.env.NODE_OPTIONS',
    },
];
/** Style constants. Only host-neutral values: no themed CSS variables are assumed. */
const S = {
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        fontSize: '12.5px',
        lineHeight: 1.6,
        color: 'inherit',
        padding: '2px 0',
    },
    header: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
    title: { fontWeight: 700, fontSize: '13.5px' },
    badge: {
        padding: '1px 7px',
        borderRadius: '999px',
        fontSize: '11px',
        border: '1px solid rgba(128, 128, 128, 0.45)',
        opacity: 0.85,
    },
    section: { display: 'flex', flexDirection: 'column', gap: '3px' },
    sectionTitle: { fontWeight: 600, fontSize: '12px', opacity: 0.85 },
    row: { display: 'grid', gridTemplateColumns: 'minmax(104px, max-content) 1fr', gap: '2px 10px', alignItems: 'baseline' },
    label: { opacity: 0.7 },
    value: { wordBreak: 'break-word' },
    mono: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '11.5px',
        wordBreak: 'break-all',
    },
    note: { opacity: 0.7, fontSize: '11.5px' },
    divider: { height: '1px', background: 'rgba(128, 128, 128, 0.25)', margin: '1px 0' },
    quotaRow: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' },
    quotaHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' },
    quotaName: { fontWeight: 600 },
    quotaAmount: { fontVariantNumeric: 'tabular-nums' },
    progressTrack: {
        position: 'relative',
        height: '6px',
        borderRadius: '999px',
        background: 'rgba(128, 128, 128, 0.22)',
        overflow: 'hidden',
    },
    progressFill: {
        position: 'absolute',
        inset: '0 auto 0 0',
        background: 'rgba(64, 156, 255, 0.75)',
        borderRadius: '999px',
    },
    planBlock: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' },
    entitlement: {
        display: 'grid',
        gridTemplateColumns: 'minmax(120px, max-content) 1fr',
        gap: '2px 10px',
        alignItems: 'baseline',
        paddingLeft: '10px',
    },
    errorText: { fontWeight: 600 },
    controls: { display: 'flex', flexDirection: 'column', gap: '4px' },
    control: {
        display: 'grid',
        gridTemplateColumns: 'minmax(104px, max-content) 1fr',
        gap: '2px 10px',
        alignItems: 'center',
    },
    select: {
        font: 'inherit',
        fontSize: '12px',
        padding: '2px 6px',
        borderRadius: '6px',
        border: '1px solid rgba(128, 128, 128, 0.45)',
        background: 'transparent',
        color: 'inherit',
        maxWidth: '100%',
    },
    retry: {
        alignSelf: 'flex-start',
        marginTop: '2px',
        padding: '2px 10px',
        fontSize: '11.5px',
        borderRadius: '6px',
        border: '1px solid rgba(128, 128, 128, 0.45)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
    },
};
/** Read a string prop without assuming the host kept the documented shape. */
function propString(props, key) {
    if (props === null || typeof props !== 'object')
        return undefined;
    const value = props[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
/** Narrow an unknown payload to a plain object. */
function recordOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
/** Read a non-empty string field. */
function readString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
/** Read the option list of a select, dropping entries the host cannot use. */
function readOptions(value) {
    if (!Array.isArray(value))
        return [];
    const options = [];
    for (const entry of value) {
        const record = recordOf(entry);
        if (record === null)
            continue;
        const id = readString(record['id']);
        const label = readString(record['label']);
        if (id === null || label === null)
            continue;
        const available = typeof record['available'] === 'boolean' ? record['available'] : undefined;
        const reason = readString(record['reason']);
        options.push({
            id,
            label,
            ...(available === undefined ? {} : { available }),
            ...(reason === null ? {} : { reason }),
        });
    }
    return options;
}
/** Read a boolean prop; `undefined` means "the host did not say". */
function propBoolean(props, key) {
    if (props === null || typeof props !== 'object')
        return undefined;
    const value = props[key];
    return typeof value === 'boolean' ? value : undefined;
}
function readSelectionEnvelope(record) {
    if (record['ok'] !== true)
        return { status: 'failed', code: 'STATE_UNAVAILABLE', message: '' };
    const state = recordOf(record['state']);
    if (state === null)
        return { status: 'failed', code: 'STATE_UNAVAILABLE', message: '' };
    const plan = readString(state['plan']);
    const model = readString(state['model']);
    const effort = readString(state['effort']);
    if (plan === null || model === null || effort === null) {
        return { status: 'failed', code: 'STATE_INCOMPLETE', message: '' };
    }
    return {
        status: 'ready',
        state: {
            plan,
            model,
            effort,
            plans: readOptions(state['plans']),
            models: readOptions(state['models']),
            efforts: readOptions(state['efforts']),
        },
    };
}
async function requestState(signal) {
    const response = await fetch(STATE_PATH, { headers: { Accept: 'application/json' }, ...(signal === undefined ? {} : { signal }) });
    const body = await response.json().catch(() => null);
    const record = recordOf(body);
    if (record === null)
        return { status: 'failed', code: 'STATE_UNREADABLE', message: '' };
    return readSelectionEnvelope(record);
}
async function writeSelection(patch, signal) {
    const response = await fetch(STATE_PATH, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(signal === undefined ? {} : { signal }),
        body: JSON.stringify(patch),
    });
    const body = await response.json().catch(() => null);
    const record = recordOf(body);
    if (record === null) {
        return { status: 'failed', code: 'STATE_UNREADABLE', message: '' };
    }
    if (record['ok'] !== true) {
        const error = recordOf(record['error']);
        const code = error === null ? null : readString(error['code']);
        return {
            status: 'failed',
            code: code ?? 'STATE_REJECTED',
            message: error === null ? '' : (readString(error['message']) ?? ''),
        };
    }
    return readSelectionEnvelope(record);
}
/** One `label: value` line of a section. */
function row(label, value, mono = false) {
    return h('div', { style: S.row }, h('span', { style: S.label }, label), h('span', { style: mono ? { ...S.value, ...S.mono } : S.value }, value));
}
/** A titled block of rows. */
function section(title, children) {
    return h('div', { style: S.section }, h('span', { style: S.sectionTitle }, title), ...children);
}
/**
 * A titled block the user can fold away. Native `<details>`/`<summary>`:
 * zero React state (the card's hooks-order contract stays untouched) and the
 * open/closed state lives in the DOM, so it survives host re-renders.
 */
function fold(title, children, open = false) {
    return h('details', { className: 'zc-fold', open }, h('summary', null, title), h('div', { className: 'zc-fold-body' }, ...children));
}
/** Walk up from the clicked switch to the group that owns the folds. */
function foldGroupOf(target) {
    if (target === null || typeof target !== 'object')
        return null;
    const closest = target.closest;
    if (typeof closest !== 'function')
        return null;
    const group = closest.call(target, '.zc-fold-group');
    if (group === null || typeof group !== 'object')
        return null;
    const query = group.querySelectorAll;
    return typeof query === 'function' ? group : null;
}
/**
 * One switch for all four read-only blocks: expand everything that is still
 * closed, otherwise collapse everything.
 *
 * The live `open` flags are the only source of truth — mirroring them into
 * React state would (a) add a hook to a component whose hooks order is pinned
 * by a test, and (b) let the switch lie after the user clicks one title alone.
 */
function toggleFolds(target) {
    const group = foldGroupOf(target);
    if (group === null)
        return;
    const folds = Array.from(group.querySelectorAll('details.zc-fold'));
    const next = !folds.every(node => node.open);
    for (const node of folds)
        node.open = next;
}
/**
 * The card header (title + badge) sharing one row with the bulk switch, then
 * every foldable block: run configuration, route/namespace, and the four
 * read-only mirrors.
 *
 * `<details>` owns its own state in the DOM, so the switch only has to find the
 * group and write `open` on each block: no hook, no ref, and the card's
 * single-exit / hooks-order contract stays exactly as it was. The header sits
 * INSIDE the group because the switch finds the group via `closest()` — and
 * with every block collapsed by default the whole card is that one row.
 *
 * The switch label is chosen by CSS (`:has()` on the group), not by JS, so it
 * stays true even when the user opens the blocks one at a time.
 */
function foldGroup(t, head, children) {
    return h('div', { className: 'zc-fold-group' }, h('div', { className: 'zc-fold-bar' }, ...head, h('button', {
        type: 'button',
        className: 'zc-fold-switch',
        onClick: (event) => toggleFolds(event.currentTarget),
    }, h('span', { className: 'zc-fold-expand' }, t('card.fold.expandAll')), h('span', { className: 'zc-fold-collapse' }, t('card.fold.collapseAll')))), ...children);
}
/**
 * The run-configuration block: plan, model and reasoning effort, each a
 * select that writes straight back to the state route.
 *
 * Layout mirrors the Antigravity card the user asked to copy: the editable
 * choices sit at the top, so the panel answers "what is it doing" before the
 * read-only mirrors below.
 */
function selectionPanel(t, view, select) {
    if (view.status === 'loading') {
        return [h('span', { style: S.note }, t('card.run.loading'))];
    }
    if (view.status === 'failed') {
        return [
            h('span', { style: S.errorText }, t('card.run.failed')),
            h('span', { style: S.note }, view.code),
            view.message.length === 0 ? null : h('span', { style: S.mono }, view.message),
        ];
    }
    const { state } = view;
    const control = (label, key, current, options) => {
        const choices = options.length === 0
            ? [h('option', { key: current, value: current }, current)]
            : options.map(option => h('option', {
                key: option.id,
                value: option.id,
                disabled: option.available === false,
                ...(option.available === false && option.reason !== undefined
                    ? { title: `${option.label} · ${option.reason}` }
                    : {}),
            }, option.label));
        return h('label', { style: S.control }, h('span', { style: S.label }, t(label)), h('select', {
            className: 'zc-select',
            value: current,
            onChange: (event) => {
                const next = event.target?.value;
                if (typeof next === 'string' && next !== current)
                    select({ [key]: next });
            },
        }, ...choices));
    };
    return [
        control('card.run.plan', 'plan', state.plan, state.plans),
        control('card.run.model', 'model', state.model, state.models),
        control('card.run.effort', 'effort', state.effort, state.efforts),
        h('span', { style: S.note }, t('card.run.note')),
    ];
}
function apply(ctx) {
    // `locale` is declared in `inject`, so cordis guarantees it here.
    const locale = ctx.locale;
    ctx.effect(() => {
        const disposeZh = locale.register(locales_js_1.NS, 'zh', locales_js_1.zh);
        const disposeEn = locale.register(locales_js_1.NS, 'en', locales_js_1.en);
        return () => {
            disposeEn();
            disposeZh();
        };
    }, 'dsh-zcode-cli: locale dictionaries');
    const useTranslation = () => {
        const [, rerender] = useState(0);
        useEffect(() => locale.subscribe(() => rerender((revision) => revision + 1)), []);
        return locale.bind(locales_js_1.NS);
    };
    /**
     * Run-configuration state: one GET on mount, plus one POST per select change.
     *
     * `request` doubles as the dependency: `seq` makes every write a distinct
     * dependency value even when the same option is picked twice, so the effect
     * re-runs without any timers or polling.
     */
    const useSelection = () => {
        const [view, setView] = useState({ status: 'loading' });
        const [request, setRequest] = useState({
            patch: null,
            seq: 0,
        });
        useEffect(() => {
            const controller = new AbortController();
            let active = true;
            const call = request.patch === null
                ? requestState(controller.signal)
                : writeSelection(request.patch, controller.signal);
            call
                .then((next) => {
                if (active)
                    setView(next);
            })
                .catch((error) => {
                if (!active || controller.signal.aborted)
                    return;
                setView({
                    status: 'failed',
                    code: 'STATE_UNAVAILABLE',
                    message: error instanceof Error ? error.message : String(error),
                });
            });
            return () => {
                active = false;
                controller.abort();
            };
        }, [request]);
        return {
            view,
            select: (patch) => {
                setRequest(previous => ({ patch, seq: previous.seq + 1 }));
            },
        };
    };
    /**
     * React hook discipline — do not move hooks below a conditional return.
     *
     * Every `useState` / `useEffect` / `useRef` this component needs must be
     * called at the very top of the body, before the first `return` and before
     * any `if (…) return …`. React matches hooks by call order: a hook that only
     * runs on one branch throws "Rendered more hooks than during the previous
     * render" on the next render, and the host's `SlotErrorBoundary` turns that
     * throw into an EMPTY element — the exact blank-row symptom this card exists
     * to remove. Hence: both hooks (`useTranslation`, then `useSelection`, which
     * owns the request state) first, and a single exit further down.
     * `tests/client.test.mjs` asserts the single-exit shape.
     */
    const ZcodeProviderCard = (props) => {
        const t = useTranslation();
        const selection = useSelection();
        const configured = propBoolean(props, 'configured');
        const provider = propString(props, 'provider') ?? PROVIDER_ROUTE;
        const badge = configured === undefined ? t('card.badge.unknown') : configured ? t('card.badge.on') : t('card.badge.off');
        const modelLine = MODELS.map((id, index) => index === 0 ? `${id} (${t('card.models.default')})` : id).join(' · ');
        return h('div', { 'data-zcode-provider-card': CARD_ID, style: S.card }, h('style', null, styles_js_1.ZC_CSS), foldGroup(t, [
            h('span', { style: S.title }, t('card.title')),
            h('span', { style: S.badge, title: provider }, badge),
        ], [
            fold(t('card.run.title'), selectionPanel(t, selection.view, selection.select)),
            h('div', { style: S.divider }),
            fold(t('card.route'), [
                row(t('card.route'), provider, true),
                row(t('card.ns'), SETTINGS_NS, true),
            ]),
            h('div', { style: S.divider }),
            fold(t('card.models'), [row(t('card.models.catalog'), modelLine)]),
            fold(t('card.defaults'), [
                row(t('card.defaults.model'), DEFAULT_MODEL, true),
                row(t('card.defaults.sessionMode'), t('card.defaults.sessionMode.value')),
                row(t('card.defaults.toolPolicy'), t('card.defaults.toolPolicy.value')),
                row(t('card.defaults.mode'), t('card.defaults.mode.value')),
                row(t('card.defaults.imageInput'), t('card.defaults.imageInput.value')),
                h('span', { style: S.note }, t('card.defaults.source')),
            ]),
            h('div', { style: S.divider }),
            fold(t('card.cli'), [
                row(t('card.cli.node'), NODE_PATH, true),
                row(t('card.cli.cjs'), ZCODE_CJS_PATH, true),
            ]),
            fold(t('card.env'), [
                h('span', { style: S.note }, t('card.env.hint')),
                ...ENV_CONTRACT.map(env => h('div', { style: S.section }, h('span', { style: S.value }, h('span', { style: S.mono }, env.name), ` — ${t(env.descriptionKey)}`), h('span', { style: S.mono }, env.expected))),
            ]),
        ]));
    };
    // Keyed slot registration. The host matches `key` against the row's
    // `entryKey` (= `settingsNs` of the directory entry) character for character;
    // a typo here re-creates the empty row without any error anywhere.
    ctx.slots.inject('settings.models.provider-card', () => {
        return ctx.slots.register({
            name: 'settings.models.provider-card',
            key: SETTINGS_NS,
            id: CARD_ID,
        }, ZcodeProviderCard);
    });
}
};
var module = { exports: {} }; var exports = module.exports;
__modules["client/index.js"](__require, exports, module);
exports.apply = module.exports.apply;
exports.inject = module.exports.inject;
exports.name = module.exports.name;
return module.exports; } });
