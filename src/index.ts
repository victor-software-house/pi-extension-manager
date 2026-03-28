/**
 * pi-extension-manager — manage local extensions and community packages.
 *
 * Command: /extensions
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createAutoUpdateNotificationHandler } from "./commands/auto-update.js";
import {
	getExtensionsAutocompleteItems,
	resolveCommand,
	runResolvedCommand,
	showNonInteractiveHelp,
	showUnknownCommandMessage,
} from "./commands/registry.js";
import { ExtensionManagerController } from "./controller.js";
import { installPackage } from "./packages/install.js";
import { tokenizeArgs } from "./utils/command.js";
import { isPackageSource } from "./utils/format.js";

export default function extensionsManager(pi: ExtensionAPI) {
	const controller = new ExtensionManagerController(pi);

	pi.registerCommand("extensions", {
		description: "Manage local extensions and browse/install community packages",
		getArgumentCompletions: getExtensionsAutocompleteItems,
		handler: async (args, ctx) => {
			const tokens = tokenizeArgs(args);
			const resolved = resolveCommand(tokens);

			if (resolved) {
				await runResolvedCommand(resolved, ctx, pi, controller);
				return;
			}

			const rawSubcommand = tokens[0];
			if (rawSubcommand && isPackageSource(rawSubcommand)) {
				await installPackage(args.trim(), ctx, pi);
				return;
			}

			if (ctx.hasUI) {
				showUnknownCommandMessage(rawSubcommand, ctx);
			} else {
				showNonInteractiveHelp(ctx);
			}
		},
	});

	function onUpdateAvailable(ctx: Parameters<typeof controller.bootstrap>[0]) {
		return createAutoUpdateNotificationHandler(ctx);
	}

	async function bootstrap(ctx: Parameters<typeof controller.bootstrap>[0]): Promise<void> {
		await controller.bootstrap(ctx, onUpdateAvailable(ctx));
	}

	pi.on("session_start", async (_event, ctx) => {
		await bootstrap(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await bootstrap(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await bootstrap(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		await bootstrap(ctx);
	});

	pi.on("session_shutdown", () => {
		controller.shutdown();
	});
}
