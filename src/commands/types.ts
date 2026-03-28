import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ExtensionManagerController } from "../controller.js";

export type CommandId =
	| "local"
	| "list"
	| "remote"
	| "installed"
	| "search"
	| "install"
	| "remove"
	| "update"
	| "history"
	| "clear-cache"
	| "auto-update"
	| "show"
	| "verify"
	| "path"
	| "reset"
	| "help";

export interface CommandDefinition {
	id: CommandId;
	description: string;
	aliases?: string[];
	runInteractive: (
		tokens: string[],
		ctx: ExtensionCommandContext,
		pi: ExtensionAPI,
		controller: ExtensionManagerController,
	) => Promise<void> | void;
	runNonInteractive: (
		tokens: string[],
		ctx: ExtensionCommandContext,
		pi: ExtensionAPI,
		controller: ExtensionManagerController,
	) => Promise<void> | void;
}
