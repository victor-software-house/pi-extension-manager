/**
 * /extensions path — show config and data paths.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DATA_DIR } from "../constants.js";
import { notify } from "../utils/notify.js";

export function showPaths(ctx: ExtensionCommandContext): void {
	const home = homedir();
	const cacheDir = DATA_DIR;

	const lines = [
		"Extension Manager Paths",
		"",
		`Global extensions:  ${join(home, ".pi", "agent", "extensions")}`,
		`Project extensions: ${join(ctx.cwd, ".pi", "extensions")}`,
		`Global packages:    ${join(home, ".pi", "agent", "packages")}`,
		`Project packages:   ${join(ctx.cwd, ".pi", "packages")}`,
		`Cache dir:          ${cacheDir}`,
		`Auto-update config: ${join(cacheDir, "auto-update.json")}`,
		`Metadata cache:     ${join(cacheDir, "metadata.json")}`,
	];

	notify(ctx, lines.join("\n"), "info");
}
