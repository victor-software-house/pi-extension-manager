import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionManagerController } from "../controller.js";
import { notify } from "../utils/notify.js";
import { parseDuration } from "../utils/settings.js";

function onUpdateAvailable(ctx: ExtensionCommandContext | ExtensionContext, packages: string[]): void {
	notify(ctx, `Updates available for ${packages.length} package(s): ${packages.join(", ")}`, "info");
}

export async function handleAutoUpdateSubcommand(
	tokens: string[],
	ctx: ExtensionCommandContext | ExtensionContext,
	_pi: ExtensionAPI,
	controller: ExtensionManagerController,
): Promise<void> {
	const trimmed = tokens.join(" ").trim();

	if (!trimmed && ctx.hasUI) {
		await controller.promptAutoUpdateWizard(ctx, (packages) => onUpdateAvailable(ctx, packages));
		void controller.refreshStatus(ctx);
		return;
	}

	const duration = parseDuration(trimmed);

	if (!duration) {
		const statusText = controller.getAutoUpdateStatusText(ctx);
		notify(ctx, `Auto-update: ${statusText}`, "info");
		notify(
			ctx,
			[
				"Usage: /ext auto-update <duration>",
				"",
				"Examples: never | 1h | 1d | 3d | 1w | 2w | 1mo | daily | weekly",
			].join("\n"),
			"info",
		);
		return;
	}

	if (duration.ms === 0) {
		controller.disableAutoUpdate(ctx);
	} else {
		await controller.enableAutoUpdate(ctx, duration.ms, duration.display, (packages) =>
			onUpdateAvailable(ctx, packages),
		);
	}

	void controller.refreshStatus(ctx);
}

export function createAutoUpdateNotificationHandler(
	ctx: ExtensionCommandContext | ExtensionContext,
): (packages: string[]) => void {
	return (packages) => onUpdateAvailable(ctx, packages);
}
