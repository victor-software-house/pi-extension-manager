/**
 * Extension change history — logging via pi.appendEntry() and querying
 * from the current session branch.
 *
 * Global history (cross-session JSONL walking) has been removed.
 * Use session-scoped querySessionChanges() for all history needs.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ChangeActionSchema = z.enum([
	"extension_toggle",
	"extension_delete",
	"package_install",
	"package_update",
	"package_remove",
	"cache_clear",
	"auto_update_config",
]);

const ExtensionChangeEntrySchema = z.object({
	action: ChangeActionSchema,
	timestamp: z.number(),
	success: z.boolean(),
	extensionId: z.string().optional(),
	fromState: z.enum(["enabled", "disabled"]).optional(),
	toState: z.enum(["enabled", "disabled"]).optional(),
	packageSource: z.string().optional(),
	packageName: z.string().optional(),
	version: z.string().optional(),
	scope: z.enum(["global", "project"]).optional(),
	detail: z.string().optional(),
	error: z.string().optional(),
});

export type ChangeAction = z.infer<typeof ChangeActionSchema>;
export type ExtensionChangeEntry = z.infer<typeof ExtensionChangeEntrySchema>;

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export interface HistoryFilters {
	limit?: number;
	action?: ChangeAction;
	success?: boolean;
	packageQuery?: string;
	sinceTimestamp?: number;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const EXT_CHANGE_CUSTOM_TYPE = "extmgr-change";

export function logChange(pi: ExtensionAPI, change: Omit<ExtensionChangeEntry, "timestamp">): void {
	pi.appendEntry(EXT_CHANGE_CUSTOM_TYPE, { ...change, timestamp: Date.now() });
}

export function logExtensionToggle(
	pi: ExtensionAPI,
	extensionId: string,
	fromState: "enabled" | "disabled",
	toState: "enabled" | "disabled",
	success: boolean,
	error?: string,
): void {
	logChange(pi, { action: "extension_toggle", extensionId, fromState, toState, success, error });
}

export function logExtensionDelete(pi: ExtensionAPI, extensionId: string, success: boolean, error?: string): void {
	logChange(pi, { action: "extension_delete", extensionId, success, error });
}

export function logAutoUpdateConfig(pi: ExtensionAPI, detail: string, success: boolean, error?: string): void {
	logChange(pi, { action: "auto_update_config", detail, success, error });
}

export function logPackageInstall(
	pi: ExtensionAPI,
	source: string,
	name: string,
	version: string | undefined,
	scope: "global" | "project",
	success: boolean,
	error?: string,
): void {
	logChange(pi, {
		action: "package_install",
		packageSource: source,
		packageName: name,
		version,
		scope,
		success,
		error,
	});
}

export function logPackageUpdate(
	pi: ExtensionAPI,
	source: string,
	name: string,
	toVersion: string | undefined,
	success: boolean,
	error?: string,
): void {
	logChange(pi, {
		action: "package_update",
		packageSource: source,
		packageName: name,
		version: toVersion,
		success,
		error,
	});
}

export function logPackageRemove(
	pi: ExtensionAPI,
	source: string,
	name: string,
	success: boolean,
	error?: string,
): void {
	logChange(pi, { action: "package_remove", packageSource: source, packageName: name, success, error });
}

export function logCacheClear(pi: ExtensionAPI, success: boolean, error?: string): void {
	logChange(pi, { action: "cache_clear", success, error });
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function matchesFilters(change: ExtensionChangeEntry, filters: HistoryFilters): boolean {
	if (filters.action && change.action !== filters.action) return false;
	if (typeof filters.success === "boolean" && change.success !== filters.success) return false;
	if (filters.sinceTimestamp && change.timestamp < filters.sinceTimestamp) return false;

	const q = filters.packageQuery?.toLowerCase().trim();
	if (q) {
		const fields = [change.packageName, change.packageSource, change.extensionId, change.detail];
		const matched = fields.some((f) => f?.toLowerCase().includes(q));
		if (!matched) return false;
	}

	return true;
}

function applyLimit<T>(items: T[], limit: number): T[] {
	return limit > 0 ? items.slice(-limit) : items;
}

export function querySessionChanges(
	ctx: ExtensionCommandContext,
	filters: HistoryFilters = {},
): ExtensionChangeEntry[] {
	const entries = ctx.sessionManager.getEntries();
	const changes: ExtensionChangeEntry[] = [];

	for (const entry of entries) {
		if (entry?.type !== "custom" || entry.customType !== EXT_CHANGE_CUSTOM_TYPE || !entry.data) continue;
		const result = ExtensionChangeEntrySchema.safeParse(entry.data);
		if (result.success) changes.push(result.data);
	}

	const filtered = changes.filter((c) => matchesFilters(c, filters));
	return applyLimit(filtered, filters.limit ?? 20);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatChangeEntry(entry: ExtensionChangeEntry): string {
	const time = new Date(entry.timestamp).toLocaleString();
	const icon = entry.success ? "+" : "x";
	const pkgLabel = entry.packageName ?? entry.packageSource ?? "unknown";
	const srcSuffix = entry.packageSource && entry.packageSource !== entry.packageName ? ` (${entry.packageSource})` : "";

	switch (entry.action) {
		case "extension_toggle":
			return `[${time}] ${icon} ${entry.extensionId}: ${entry.fromState} -> ${entry.toState}`;
		case "extension_delete":
			return `[${time}] ${icon} Deleted ${entry.extensionId ?? "extension"}`;
		case "package_install":
			return `[${time}] ${icon} Installed ${pkgLabel}${entry.version ? `@${entry.version}` : ""}${srcSuffix}`;
		case "package_update":
			return `[${time}] ${icon} Updated ${pkgLabel}${entry.version ? ` -> @${entry.version}` : ""}${srcSuffix}`;
		case "package_remove":
			return `[${time}] ${icon} Removed ${pkgLabel}${srcSuffix}`;
		case "cache_clear":
			return `[${time}] ${icon} Cache cleared`;
		case "auto_update_config":
			return `[${time}] ${icon} Auto-update ${entry.detail ?? "configuration changed"}`;
		default:
			return `[${time}] ${icon} Unknown action`;
	}
}
