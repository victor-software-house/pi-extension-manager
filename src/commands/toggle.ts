/**
 * /extensions enable|disable <pattern> — toggle extensions from CLI.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { discoverExtensions, setExtensionState } from "../extensions/discovery.js";
import type { State } from "../types/index.js";
import { logExtensionToggle } from "../utils/history.js";
import { notify } from "../utils/notify.js";

export async function toggleExtension(
	tokens: string[],
	targetState: State,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
): Promise<void> {
	const pattern = tokens.join(" ").trim();
	if (!pattern) {
		notify(ctx, `Usage: /extensions ${targetState === "enabled" ? "enable" : "disable"} <name-or-path>`, "info");
		return;
	}

	const extensions = await discoverExtensions(ctx.cwd);
	const lowerPattern = pattern.toLowerCase();

	// Match by display name (substring) or full path
	const matches = extensions.filter(
		(e) =>
			e.displayName.toLowerCase().includes(lowerPattern) ||
			e.activePath.toLowerCase().includes(lowerPattern) ||
			e.disabledPath.toLowerCase().includes(lowerPattern),
	);

	if (matches.length === 0) {
		notify(ctx, `No extension matching "${pattern}" found.`, "warning");
		return;
	}

	if (matches.length > 1) {
		const names = matches.map((e) => `  ${e.displayName} (${e.state})`).join("\n");
		notify(ctx, `Multiple matches for "${pattern}":\n${names}\nBe more specific.`, "warning");
		return;
	}

	const ext = matches[0];
	if (!ext) return;

	if (ext.state === targetState) {
		notify(ctx, `${ext.displayName} is already ${targetState}.`, "info");
		return;
	}

	const result = await setExtensionState({ activePath: ext.activePath, disabledPath: ext.disabledPath }, targetState);

	if (!result.ok) {
		logExtensionToggle(pi, ext.id, ext.state, targetState, false, result.error);
		notify(
			ctx,
			`Failed to ${targetState === "enabled" ? "enable" : "disable"} ${ext.displayName}: ${result.error}`,
			"error",
		);
		return;
	}

	logExtensionToggle(pi, ext.id, ext.state, targetState, true);
	notify(ctx, `${ext.displayName} ${targetState}. Use /reload to apply.`, "info");
}
