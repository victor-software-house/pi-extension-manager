/**
 * /extensions verify — check runtime dependencies.
 */
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { notify } from "../utils/notify.js";

interface Check {
	label: string;
	ok: boolean;
	detail: string;
}

async function dirExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function dirEntryCount(path: string): Promise<number> {
	try {
		const entries = await readdir(path);
		return entries.length;
	} catch {
		return 0;
	}
}

async function npmAvailable(): Promise<boolean> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const exec = promisify(execFile);
	try {
		await exec("npm", ["--version"]);
		return true;
	} catch {
		return false;
	}
}

export async function verifyRuntime(ctx: ExtensionCommandContext): Promise<void> {
	const checks: Check[] = [];
	const home = homedir();

	// npm availability
	const hasNpm = await npmAvailable();
	checks.push({
		label: "npm",
		ok: hasNpm,
		detail: hasNpm ? "available" : "not found (install/update required)",
	});

	// Global extensions dir
	const globalExtDir = join(home, ".pi", "agent", "extensions");
	const globalExtExists = await dirExists(globalExtDir);
	const globalExtCount = globalExtExists ? await dirEntryCount(globalExtDir) : 0;
	checks.push({
		label: "Global extensions dir",
		ok: globalExtExists,
		detail: globalExtExists ? `${globalExtCount} entries` : "missing",
	});

	// Project extensions dir
	const projectExtDir = join(ctx.cwd, ".pi", "extensions");
	const projectExtExists = await dirExists(projectExtDir);
	const projectExtCount = projectExtExists ? await dirEntryCount(projectExtDir) : 0;
	checks.push({
		label: "Project extensions dir",
		ok: true, // optional, never a failure
		detail: projectExtExists ? `${projectExtCount} entries` : "not present (optional)",
	});

	// Cache dir
	const { DATA_DIR: cacheDir } = await import("../constants.js");
	const cacheExists = await dirExists(cacheDir);
	checks.push({
		label: "Cache dir",
		ok: cacheExists,
		detail: cacheExists ? "writable" : "missing (will be created on first use)",
	});

	// Global npm packages dir (where pi install puts things)
	const globalNpmDir = join(home, ".pi", "agent", "packages");
	const globalNpmExists = await dirExists(globalNpmDir);
	const globalNpmCount = globalNpmExists ? await dirEntryCount(globalNpmDir) : 0;
	checks.push({
		label: "Global packages dir",
		ok: true, // optional
		detail: globalNpmExists ? `${globalNpmCount} entries` : "not present (no packages installed)",
	});

	const passed = checks.filter((c) => c.ok).length;
	const failed = checks.filter((c) => !c.ok).length;

	const lines = ["Runtime Verification", ""];
	for (const check of checks) {
		const status = check.ok ? "PASS" : "FAIL";
		lines.push(`  [${status}] ${check.label}: ${check.detail}`);
	}
	lines.push("");
	lines.push(`${passed} passed, ${failed} failed`);

	notify(ctx, lines.join("\n"), failed > 0 ? "warning" : "info");
}
