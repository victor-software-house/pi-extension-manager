/**
 * Help display
 */
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export function showHelp(ctx: ExtensionCommandContext): void {
	const lines = [
		"Extension Manager Help",
		"",
		"Unified View:",
		"  Local extensions and npm/git packages are displayed together",
		"  Local extensions show [x] enabled / [ ] disabled with G/P scope",
		"  Packages show name@version and G/P scope",
		"",
		"Navigation:",
		"  up/down      Navigate list",
		"  Space/Enter  Toggle local extension enabled/disabled",
		"  S            Save changes to local extensions",
		"  Enter/A      Open actions for selected package",
		"  c            Configure selected package extensions",
		"  u            Update selected package",
		"  X            Remove selected item",
		"  i            Quick install by source",
		"  f            Quick search",
		"  U            Update all packages",
		"  t            Auto-update wizard",
		"  P/M          Quick actions palette",
		"  R            Browse remote packages",
		"  ?/H          Show this help",
		"  Esc          Cancel",
		"",
		"Extension Sources:",
		"  - ~/.pi/agent/extensions/ (global - G)",
		"  - .pi/extensions/ (project-local - P)",
		"  - npm packages installed via pi install",
		"  - git packages installed via pi install",
		"",
		"Commands:",
		"  /ext              Open manager",
		"  /ext show         Summarize current state",
		"  /ext list         List local extensions",
		"  /ext installed    List installed packages",
		"  /ext remote       Browse community packages",
		"  /ext search <q>   Search for packages",
		"  /ext install <s> [--project|--global]  Install package",
		"  /ext remove <s>   Remove installed package",
		"  /ext update [s]   Update package (or all packages)",
		"  /ext history [o]  Show history (supports filters)",
		"  /ext auto-update  Show or change update schedule",
		"  /ext verify       Check runtime dependencies",
		"  /ext path         Show config and data paths",
		"  /ext reset        Reset settings to defaults",
		"  /ext help         Show this help",
	];

	const output = lines.join("\n");
	if (ctx.hasUI) {
		ctx.ui.notify(output, "info");
	} else {
		console.log(output);
	}
}
