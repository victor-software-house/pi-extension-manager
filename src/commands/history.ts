import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { type ChangeAction, formatChangeEntry, type HistoryFilters, querySessionChanges } from "../utils/history.js";
import { notify } from "../utils/notify.js";
import { formatListOutput } from "../utils/ui-helpers.js";

const HISTORY_ACTIONS: ChangeAction[] = [
	"extension_toggle",
	"extension_delete",
	"package_install",
	"package_update",
	"package_remove",
	"cache_clear",
	"auto_update_config",
];

interface ParsedHistoryArgs {
	filters: HistoryFilters;
	showHelp: boolean;
	errors: string[];
}

const HISTORY_ACTION_SET = new Set<ChangeAction>(HISTORY_ACTIONS);

function parseHistorySinceDuration(input: string): number | undefined {
	const normalized = input.toLowerCase().trim();
	const match = normalized.match(
		/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months)$/,
	);
	if (!match) return undefined;

	const value = parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(value) || value <= 0) return undefined;

	const unit = (match[2] ?? "")[0] ?? "";
	if (unit === "m" && !(match[2] ?? "").startsWith("mo")) return value * 60 * 1000;
	if (unit === "h") return value * 60 * 60 * 1000;
	if (unit === "d") return value * 24 * 60 * 60 * 1000;
	if (unit === "w") return value * 7 * 24 * 60 * 60 * 1000;
	if (unit === "m") return value * 30 * 24 * 60 * 60 * 1000; // "mo"
	return undefined;
}

function parseHistoryArgs(tokens: string[]): ParsedHistoryArgs {
	const filters: HistoryFilters = { limit: 20 };
	let showHelp = false;
	const errors: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i] ?? "";

		if (token === "--help" || token === "-h") {
			showHelp = true;
		} else if (token === "--limit") {
			const val = parseInt(tokens[++i] ?? "", 10);
			if (!Number.isFinite(val) || val <= 0) errors.push(`Invalid --limit value`);
			else filters.limit = val;
		} else if (token === "--action") {
			const val = tokens[++i] as ChangeAction | undefined;
			if (!val || !HISTORY_ACTION_SET.has(val)) errors.push(`Invalid --action: ${val ?? "(missing)"}`);
			else filters.action = val;
		} else if (token === "--failed") {
			filters.success = false;
		} else if (token === "--success") {
			filters.success = true;
		} else if (token === "--package") {
			const val = tokens[++i];
			if (!val) errors.push("--package requires a value");
			else filters.packageQuery = val;
		} else if (token === "--since") {
			const val = tokens[++i];
			if (!val) {
				errors.push("--since requires a duration");
				continue;
			}
			const ms = parseHistorySinceDuration(val);
			if (!ms) errors.push(`Invalid --since duration: ${val}`);
			else filters.sinceTimestamp = Date.now() - ms;
		} else if (token === "--global") {
			errors.push("--global is no longer supported. History is scoped to the current session.");
		} else if (token) {
			errors.push(`Unknown option: ${token}`);
		}
	}

	return { filters, showHelp, errors };
}

function showHistoryHelp(ctx: ExtensionCommandContext): void {
	notify(
		ctx,
		[
			"Usage: /ext history [options]",
			"",
			"  --limit <n>      Maximum entries (default: 20)",
			`  --action <type>  ${HISTORY_ACTIONS.join(" | ")}`,
			"  --success        Only successful entries",
			"  --failed         Only failed entries",
			"  --package <q>    Filter by package/source/extension id",
			"  --since <d>      Entries newer than duration (e.g. 30m, 24h, 7d)",
			"",
			"Examples:",
			"  /ext history --failed --limit 50",
			"  /ext history --action package_update --since 7d",
		].join("\n"),
		"info",
	);
}

export async function handleHistorySubcommand(
	ctx: ExtensionCommandContext,
	_pi: ExtensionAPI,
	tokens: string[],
	_allowGlobal: boolean,
): Promise<void> {
	const parsed = parseHistoryArgs(tokens);

	if (parsed.showHelp) {
		showHistoryHelp(ctx);
		return;
	}

	if (parsed.errors.length > 0) {
		notify(ctx, parsed.errors.join("\n"), "warning");
		showHistoryHelp(ctx);
		return;
	}

	const changes = querySessionChanges(ctx, parsed.filters);
	if (changes.length === 0) {
		notify(ctx, "No matching extension changes found in this session.", "info");
		return;
	}

	const lines = changes.map(formatChangeEntry);
	formatListOutput(ctx, `Extension Change History (recent ${changes.length})`, lines);
}
