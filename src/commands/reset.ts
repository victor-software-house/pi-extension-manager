/**
 * /extensions reset — reset settings to defaults.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionManagerController } from "../controller.js";
import { clearCache } from "../utils/cache.js";
import { notify } from "../utils/notify.js";

export async function resetSettings(
	ctx: ExtensionCommandContext,
	_pi: ExtensionAPI,
	controller: ExtensionManagerController,
): Promise<void> {
	if (ctx.hasUI) {
		const confirmed = await ctx.ui.confirm(
			"Reset Extension Manager",
			"This will disable auto-update and clear the metadata cache. Continue?",
		);
		if (!confirmed) return;
	}

	controller.disableAutoUpdate(ctx);
	await clearCache();

	notify(ctx, "Extension manager settings reset. Auto-update disabled, cache cleared.", "info");
}
