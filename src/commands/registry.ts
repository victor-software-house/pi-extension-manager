import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionManagerController } from "../controller.js";
import {
	promptRemove,
	removePackage,
	showInstalledPackagesList,
	updatePackage,
	updatePackages,
} from "../packages/management.js";
import { showInteractive, showListOnly } from "../ui/manager.js";
import { showRemote } from "../ui/remote.js";
import { notify } from "../utils/notify.js";
import { handleAutoUpdateSubcommand } from "./auto-update.js";
import { clearMetadataCacheCommand } from "./cache.js";
import { handleHistorySubcommand } from "./history.js";
import { handleInstallSubcommand, INSTALL_USAGE } from "./install.js";
import { showPaths } from "./path.js";
import { resetSettings } from "./reset.js";
import { showSummary } from "./show.js";
import { toggleExtension } from "./toggle.js";
import type { CommandDefinition, CommandId } from "./types.js";
import { verifyRuntime } from "./verify.js";

const REMOVE_USAGE = "Usage: /extensions remove <npm:package|git:url|path>";

function requireInteractiveCommand(ctx: ExtensionCommandContext, feature: string): void {
	notify(ctx, `${feature} requires interactive mode.`, "warning");
}

function showNonInteractiveHelp(ctx: ExtensionCommandContext): void {
	const lines = [
		"Extension Manager",
		"",
		"Commands:",
		"  /extensions              - Open interactive manager",
		"  /extensions show         - Summarize current state",
		"  /extensions list         - List local extensions",
		"  /extensions installed    - List installed packages",
		`  ${INSTALL_USAGE}`,
		"  /extensions remove <s>   - Remove a package",
		"  /extensions update [s]   - Update one or all packages",
		"  /extensions remote       - Browse community packages",
		"  /extensions history      - Show change history",
		"  /extensions auto-update  - Configure auto-update schedule",
		"  /extensions enable <n>   - Enable a local extension",
		"  /extensions disable <n>  - Disable a local extension",
		"  /extensions verify       - Check runtime dependencies",
		"  /extensions path         - Show config and data paths",
		"  /extensions reset        - Reset settings to defaults",
		"  /extensions help         - Show this help",
	];

	notify(ctx, lines.join("\n"), "info");
}

const COMMAND_DEFINITIONS: Record<CommandId, CommandDefinition> = {
	show: {
		id: "show",
		description: "Summarize current state",
		aliases: ["status"],
		runInteractive: (_tokens, ctx, pi, controller) => showSummary(ctx, pi, controller),
		runNonInteractive: (_tokens, ctx, pi, controller) => showSummary(ctx, pi, controller),
	},
	local: {
		id: "local",
		description: "Open interactive manager (default)",
		runInteractive: (_tokens, ctx, pi, controller) => showInteractive(ctx, pi, controller),
		runNonInteractive: (_tokens, ctx) => showListOnly(ctx),
	},
	list: {
		id: "list",
		description: "List local extensions",
		runInteractive: (_tokens, ctx) => showListOnly(ctx),
		runNonInteractive: (_tokens, ctx) => showListOnly(ctx),
	},
	remote: {
		id: "remote",
		description: "Browse community packages",
		aliases: ["packages"],
		runInteractive: async (tokens, ctx, pi) => {
			await showRemote(tokens.join(" "), ctx, pi);
		},
		runNonInteractive: (_tokens, ctx) => {
			requireInteractiveCommand(ctx, "Remote package browsing");
			showNonInteractiveHelp(ctx);
		},
	},
	installed: {
		id: "installed",
		description: "List installed packages",
		runInteractive: (_tokens, ctx, pi) => showInstalledPackagesList(ctx, pi),
		runNonInteractive: (_tokens, ctx, pi) => showInstalledPackagesList(ctx, pi),
	},
	search: {
		id: "search",
		description: "Search npm for packages",
		runInteractive: async (tokens, ctx, pi) => {
			await showRemote(`search ${tokens.join(" ")}`, ctx, pi);
		},
		runNonInteractive: (_tokens, ctx) => {
			requireInteractiveCommand(ctx, "Search");
			showNonInteractiveHelp(ctx);
		},
	},
	install: {
		id: "install",
		description: "Install a package",
		runInteractive: async (tokens, ctx, pi) => {
			if (tokens.length > 0) {
				await handleInstallSubcommand(tokens, ctx, pi);
				return;
			}
			await showRemote("install", ctx, pi);
		},
		runNonInteractive: (tokens, ctx, pi) =>
			tokens.length > 0 ? handleInstallSubcommand(tokens, ctx, pi) : notify(ctx, INSTALL_USAGE, "info"),
	},
	remove: {
		id: "remove",
		description: "Remove an installed package",
		aliases: ["uninstall"],
		runInteractive: (tokens, ctx, pi) =>
			tokens.length > 0 ? removePackage(tokens.join(" "), ctx, pi) : promptRemove(ctx, pi),
		runNonInteractive: (tokens, ctx, pi) =>
			tokens.length > 0 ? removePackage(tokens.join(" "), ctx, pi) : notify(ctx, REMOVE_USAGE, "info"),
	},
	update: {
		id: "update",
		description: "Update one package or all packages",
		runInteractive: (tokens, ctx, pi) =>
			tokens.length > 0 ? updatePackage(tokens.join(" "), ctx, pi) : updatePackages(ctx, pi),
		runNonInteractive: (tokens, ctx, pi) =>
			tokens.length > 0 ? updatePackage(tokens.join(" "), ctx, pi) : updatePackages(ctx, pi),
	},
	history: {
		id: "history",
		description: "View extension change history",
		runInteractive: (tokens, ctx, pi) => handleHistorySubcommand(ctx, pi, tokens, false),
		runNonInteractive: (tokens, ctx, pi) => handleHistorySubcommand(ctx, pi, tokens, true),
	},
	"clear-cache": {
		id: "clear-cache",
		description: "Clear metadata cache",
		runInteractive: (_tokens, ctx, pi) => clearMetadataCacheCommand(ctx, pi),
		runNonInteractive: (_tokens, ctx, pi) => clearMetadataCacheCommand(ctx, pi),
	},
	"auto-update": {
		id: "auto-update",
		description: "Configure auto-update schedule",
		runInteractive: (tokens, ctx, pi, controller) => handleAutoUpdateSubcommand(tokens, ctx, pi, controller),
		runNonInteractive: (tokens, ctx, pi, controller) => handleAutoUpdateSubcommand(tokens, ctx, pi, controller),
	},
	verify: {
		id: "verify",
		description: "Check runtime dependencies",
		runInteractive: (_tokens, ctx) => verifyRuntime(ctx),
		runNonInteractive: (_tokens, ctx) => verifyRuntime(ctx),
	},
	path: {
		id: "path",
		description: "Show config and data paths",
		aliases: ["paths"],
		runInteractive: (_tokens, ctx) => {
			showPaths(ctx);
			return Promise.resolve();
		},
		runNonInteractive: (_tokens, ctx) => {
			showPaths(ctx);
			return Promise.resolve();
		},
	},
	reset: {
		id: "reset",
		description: "Reset settings to defaults",
		runInteractive: (_tokens, ctx, pi, controller) => resetSettings(ctx, pi, controller),
		runNonInteractive: (_tokens, ctx, pi, controller) => resetSettings(ctx, pi, controller),
	},
	enable: {
		id: "enable",
		description: "Enable a local extension",
		runInteractive: (tokens, ctx, pi) => toggleExtension(tokens, "enabled", ctx, pi),
		runNonInteractive: (tokens, ctx, pi) => toggleExtension(tokens, "enabled", ctx, pi),
	},
	disable: {
		id: "disable",
		description: "Disable a local extension",
		runInteractive: (tokens, ctx, pi) => toggleExtension(tokens, "disabled", ctx, pi),
		runNonInteractive: (tokens, ctx, pi) => toggleExtension(tokens, "disabled", ctx, pi),
	},
	help: {
		id: "help",
		description: "Show usage help",
		runInteractive: (_tokens, ctx) => {
			showNonInteractiveHelp(ctx);
			return Promise.resolve();
		},
		runNonInteractive: (_tokens, ctx) => {
			showNonInteractiveHelp(ctx);
			return Promise.resolve();
		},
	},
};

function buildCommandAliasMap(definitions: Record<CommandId, CommandDefinition>): Record<string, CommandId> {
	const map: Record<string, CommandId> = {};
	for (const def of Object.values(definitions)) {
		map[def.id] = def.id;
		for (const alias of def.aliases ?? []) {
			map[alias] = def.id;
		}
	}
	return map;
}

const COMMAND_ALIAS_TO_ID: Record<string, CommandId> = buildCommandAliasMap(COMMAND_DEFINITIONS);

export function resolveCommand(tokens: string[]): { id: CommandId; args: string[] } | undefined {
	if (tokens.length === 0) {
		return { id: "local", args: [] };
	}

	const normalized = tokens[0]?.toLowerCase() ?? "";
	const id = COMMAND_ALIAS_TO_ID[normalized];
	if (!id) return undefined;

	return { id, args: tokens.slice(1) };
}

export function runResolvedCommand(
	resolved: { id: CommandId; args: string[] },
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	controller: ExtensionManagerController,
): Promise<void> | void {
	const definition = COMMAND_DEFINITIONS[resolved.id];
	const runner = ctx.hasUI ? definition.runInteractive : definition.runNonInteractive;
	return runner(resolved.args, ctx, pi, controller);
}

export function getExtensionsAutocompleteItems(prefix: string): AutocompleteItem[] | null {
	const items = Object.values(COMMAND_DEFINITIONS).flatMap((def) => {
		const base = [{ value: def.id, description: def.description }];
		const aliases = (def.aliases ?? []).map((alias) => ({
			value: alias,
			description: `${def.description} (alias)`,
		}));
		return [...base, ...aliases];
	});

	const safePrefix = (prefix ?? "").toLowerCase();
	const filtered = items.filter(
		(item) => item.value.toLowerCase().startsWith(safePrefix) || item.description.toLowerCase().includes(safePrefix),
	);

	return filtered.length > 0
		? filtered.map((item) => ({ value: item.value, label: `${item.value} - ${item.description}` }))
		: null;
}

export function showUnknownCommandMessage(rawSubcommand: string | undefined, ctx: ExtensionCommandContext): void {
	const known = Object.keys(COMMAND_ALIAS_TO_ID)
		.filter((key) => key === COMMAND_ALIAS_TO_ID[key])
		.sort()
		.join(", ");

	notify(ctx, `Unknown command: ${rawSubcommand ?? "(empty)"}. Try: ${known}`, "warning");
}

export { showNonInteractiveHelp };
