/**
 * /extensions show — summarize current state without opening the panel.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionManagerController } from "../controller.js";
import { discoverExtensions } from "../extensions/discovery.js";
import { getInstalledPackages } from "../packages/discovery.js";
import { getCacheStats } from "../utils/cache.js";
import { notify } from "../utils/notify.js";

export async function showSummary(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	controller: ExtensionManagerController,
): Promise<void> {
	const [extensions, packages, cacheStats, autoUpdateConfig] = await Promise.all([
		discoverExtensions(ctx.cwd),
		getInstalledPackages(ctx, pi),
		getCacheStats(),
		controller.getConfigAsync(ctx),
	]);

	const enabledCount = extensions.filter((e) => e.state === "enabled").length;
	const disabledCount = extensions.filter((e) => e.state === "disabled").length;
	const globalExts = extensions.filter((e) => e.scope === "global").length;
	const projectExts = extensions.filter((e) => e.scope === "project").length;

	const globalPkgs = packages.filter((p) => p.scope === "global").length;
	const projectPkgs = packages.filter((p) => p.scope === "project").length;

	const lines: string[] = [
		"Extension Manager Status",
		"",
		`Local extensions: ${extensions.length} (${enabledCount} enabled, ${disabledCount} disabled)`,
	];

	if (globalExts > 0 || projectExts > 0) {
		lines.push(`  global: ${globalExts}  project: ${projectExts}`);
	}

	lines.push(`Installed packages: ${packages.length}`);
	if (globalPkgs > 0 || projectPkgs > 0) {
		lines.push(`  global: ${globalPkgs}  project: ${projectPkgs}`);
	}

	lines.push("");

	// Auto-update status
	if (autoUpdateConfig.enabled) {
		const running = controller.isAutoUpdateRunning() ? "running" : "paused";
		lines.push(`Auto-update: ${autoUpdateConfig.displayText} (${running})`);
		if (autoUpdateConfig.lastCheck) {
			const ago = formatRelativeTime(autoUpdateConfig.lastCheck);
			lines.push(`  last check: ${ago}`);
		}
	} else {
		lines.push("Auto-update: off");
	}

	const knownUpdates = autoUpdateConfig.updatesAvailable ?? [];
	if (knownUpdates.length > 0) {
		lines.push(`  ${knownUpdates.length} update${knownUpdates.length === 1 ? "" : "s"} available`);
	}

	// Cache stats
	lines.push(
		`Cache: ${cacheStats.totalPackages} entries (${cacheStats.validEntries} valid, ${cacheStats.expiredEntries} expired)`,
	);

	notify(ctx, lines.join("\n"), "info");
}

function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
