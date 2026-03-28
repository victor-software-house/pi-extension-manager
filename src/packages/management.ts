/**
 * Package management (update, remove)
 */
import type { ExtensionAPI, ExtensionCommandContext, ProgressEvent } from "@mariozechner/pi-coding-agent";
import { UI } from "../constants.js";
import type { InstalledPackage } from "../types/index.js";
import { runTaskWithLoader } from "../ui/async-task.js";
import { formatInstalledPackageLabel } from "../utils/format.js";
import { logPackageRemove, logPackageUpdate } from "../utils/history.js";
import { requireUI } from "../utils/mode.js";
import { notify, error as notifyError, success } from "../utils/notify.js";
import { normalizePackageIdentity } from "../utils/package-source.js";
import { clearUpdatesAvailable } from "../utils/settings.js";
import { updateExtmgrStatus } from "../utils/status.js";
import {
	confirmAction,
	formatListOutput,
	handleReloadRequirement,
	noReloadOutcome,
	type ReloadMode,
	showProgress,
} from "../utils/ui-helpers.js";
import { getPackageCatalog } from "./catalog.js";
import { clearSearchCache, getInstalledPackages, getInstalledPackagesAllScopes } from "./discovery.js";

export interface PackageMutationOutcome {
	reloaded: boolean;
	reloadRequired: boolean;
}

const NO_PACKAGE_MUTATION_OUTCOME: PackageMutationOutcome = {
	reloaded: false,
	reloadRequired: false,
};

const BULK_UPDATE_LABEL = "all packages";

function packageMutationOutcome(overrides: Partial<PackageMutationOutcome>): PackageMutationOutcome {
	return { ...NO_PACKAGE_MUTATION_OUTCOME, ...overrides };
}

function getProgressMessage(event: ProgressEvent, fallback: string): string {
	return event.message?.trim() || fallback;
}

async function updatePackageInternal(
	source: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	reloadMode: ReloadMode = "prompt",
): Promise<PackageMutationOutcome> {
	showProgress(ctx, "Updating", source);

	const updateIdentity = normalizePackageIdentity(source);

	try {
		const updates = await getPackageCatalog(ctx.cwd).checkForAvailableUpdates();
		const hasUpdate = updates.some((update) => normalizePackageIdentity(update.source) === updateIdentity);

		if (!hasUpdate) {
			notify(ctx, `${source} is already up to date (or pinned).`, "info");
			logPackageUpdate(pi, source, source, undefined, true);
			clearUpdatesAvailable(pi, ctx, [updateIdentity]);
			void updateExtmgrStatus(ctx, pi);
			return noReloadOutcome();
		}

		await runTaskWithLoader(
			ctx,
			{
				title: "Update Package",
				message: `Updating ${source}...`,
				cancellable: false,
			},
			async ({ setMessage }) => {
				await getPackageCatalog(ctx.cwd).update(source, (event) => {
					setMessage(getProgressMessage(event, `Updating ${source}...`));
				});
				return undefined;
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const errorMsg = `Update failed: ${message}`;
		logPackageUpdate(pi, source, source, undefined, false, errorMsg);
		notifyError(ctx, errorMsg);
		void updateExtmgrStatus(ctx, pi);
		return noReloadOutcome();
	}

	logPackageUpdate(pi, source, source, undefined, true);
	success(ctx, `Updated ${source}`);
	clearUpdatesAvailable(pi, ctx, [updateIdentity]);

	const reloadOutcome = await handleReloadRequirement(ctx, "Package updated.", reloadMode);
	if (!reloadOutcome.reloaded) {
		void updateExtmgrStatus(ctx, pi);
	}
	return packageMutationOutcome(reloadOutcome);
}

async function updatePackagesInternal(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	reloadMode: ReloadMode = "prompt",
): Promise<PackageMutationOutcome> {
	showProgress(ctx, "Updating", "all packages");

	try {
		const updates = await getPackageCatalog(ctx.cwd).checkForAvailableUpdates();
		if (updates.length === 0) {
			notify(ctx, "All packages are already up to date.", "info");
			logPackageUpdate(pi, BULK_UPDATE_LABEL, BULK_UPDATE_LABEL, undefined, true);
			clearUpdatesAvailable(pi, ctx);
			void updateExtmgrStatus(ctx, pi);
			return noReloadOutcome();
		}

		await runTaskWithLoader(
			ctx,
			{
				title: "Update Packages",
				message: "Updating all packages...",
				cancellable: false,
			},
			async ({ setMessage }) => {
				await getPackageCatalog(ctx.cwd).update(undefined, (event) => {
					setMessage(getProgressMessage(event, "Updating all packages..."));
				});
				return undefined;
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const errorMsg = `Update failed: ${message}`;
		logPackageUpdate(pi, BULK_UPDATE_LABEL, BULK_UPDATE_LABEL, undefined, false, errorMsg);
		notifyError(ctx, errorMsg);
		void updateExtmgrStatus(ctx, pi);
		return noReloadOutcome();
	}

	logPackageUpdate(pi, BULK_UPDATE_LABEL, BULK_UPDATE_LABEL, undefined, true);
	success(ctx, "Packages updated");
	clearUpdatesAvailable(pi, ctx);

	const reloadOutcome = await handleReloadRequirement(ctx, "Packages updated.", reloadMode);
	if (!reloadOutcome.reloaded) {
		void updateExtmgrStatus(ctx, pi);
	}
	return packageMutationOutcome(reloadOutcome);
}

export async function updatePackage(source: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	await updatePackageInternal(source, ctx, pi);
}

export async function updatePackageWithOutcome(
	source: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	reloadMode: ReloadMode = "prompt",
): Promise<PackageMutationOutcome> {
	return updatePackageInternal(source, ctx, pi, reloadMode);
}

export async function updatePackages(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	await updatePackagesInternal(ctx, pi);
}

export async function updatePackagesWithOutcome(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	reloadMode: ReloadMode = "prompt",
): Promise<PackageMutationOutcome> {
	return updatePackagesInternal(ctx, pi, reloadMode);
}

function packageIdentity(source: string): string {
	return normalizePackageIdentity(source);
}

async function getInstalledPackagesAllScopesForRemoval(ctx: ExtensionCommandContext): Promise<InstalledPackage[]> {
	return getInstalledPackagesAllScopes(ctx);
}

type RemovalScopeChoice = "both" | "global" | "project" | "cancel";

interface RemovalTarget {
	scope: "global" | "project";
	source: string;
	name: string;
}

function scopeChoiceFromLabel(choice: string | undefined): RemovalScopeChoice {
	if (!choice || choice === "Cancel") return "cancel";
	if (choice.includes("Both")) return "both";
	if (choice.includes("Global")) return "global";
	if (choice.includes("Project")) return "project";
	return "cancel";
}

async function selectRemovalScope(ctx: ExtensionCommandContext): Promise<RemovalScopeChoice> {
	if (!ctx.hasUI) return "global";

	const choice = await ctx.ui.select("Remove scope", [
		"Both global + project",
		"Global only",
		"Project only",
		"Cancel",
	]);

	return scopeChoiceFromLabel(choice);
}

function buildRemovalTargets(
	matching: InstalledPackage[],
	hasUI: boolean,
	scopeChoice: RemovalScopeChoice,
): RemovalTarget[] {
	const byScope = new Map(matching.map((pkg) => [pkg.scope, pkg] as const));
	const addTarget = (scope: "global" | "project") => {
		const pkg = byScope.get(scope);
		return pkg ? [{ scope, source: pkg.source, name: pkg.name }] : [];
	};

	if (byScope.has("global") && byScope.has("project")) {
		switch (scopeChoice) {
			case "both":
				return [...addTarget("global"), ...addTarget("project")];
			case "global":
				return addTarget("global");
			case "project":
				return addTarget("project");
			default:
				return [];
		}
	}

	const allTargets = matching.map((pkg) => ({
		scope: pkg.scope,
		source: pkg.source,
		name: pkg.name,
	}));
	return hasUI ? allTargets : allTargets.slice(0, 1);
}

function formatRemovalTargets(targets: RemovalTarget[]): string {
	return targets.map((t) => `${t.scope}: ${t.source}`).join("\n");
}

interface RemovalExecutionResult {
	target: RemovalTarget;
	success: boolean;
	error?: string;
}

async function executeRemovalTargets(
	targets: RemovalTarget[],
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
): Promise<RemovalExecutionResult[]> {
	const results: RemovalExecutionResult[] = [];

	for (const target of targets) {
		showProgress(ctx, "Removing", `${target.source} (${target.scope})`);

		try {
			await runTaskWithLoader(
				ctx,
				{
					title: "Remove Package",
					message: `Removing ${target.source}...`,
					cancellable: false,
				},
				async ({ setMessage }) => {
					await getPackageCatalog(ctx.cwd).remove(target.source, target.scope, (event) => {
						setMessage(getProgressMessage(event, `Removing ${target.source}...`));
					});
					return undefined;
				},
			);

			logPackageRemove(pi, target.source, target.name, true);
			results.push({ target, success: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const errorMsg = `Remove failed (${target.scope}): ${message}`;
			logPackageRemove(pi, target.source, target.name, false, errorMsg);
			results.push({ target, success: false, error: errorMsg });
		}
	}

	return results;
}

function notifyRemovalSummary(
	source: string,
	remaining: InstalledPackage[],
	failures: string[],
	ctx: ExtensionCommandContext,
): void {
	if (failures.length > 0) {
		notifyError(ctx, failures.join("\n"));
	}

	if (remaining.length > 0) {
		const remainingScopes = Array.from(new Set(remaining.map((p) => p.scope))).join(", ");
		notify(ctx, `Removed from selected scope(s). Still installed in: ${remainingScopes}.`, "warning");
		return;
	}

	if (failures.length === 0) {
		success(ctx, `Removed ${source}.`);
	}
}

async function removePackageInternal(
	source: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	reloadMode: ReloadMode = "prompt",
): Promise<PackageMutationOutcome> {
	const installed = await getInstalledPackagesAllScopesForRemoval(ctx);
	const identity = packageIdentity(source);
	const matching = installed.filter((p) => packageIdentity(p.source) === identity);

	const hasBothScopes =
		matching.some((pkg) => pkg.scope === "global") && matching.some((pkg) => pkg.scope === "project");
	const scopeChoice = hasBothScopes ? await selectRemovalScope(ctx) : "both";

	if (scopeChoice === "cancel") {
		notify(ctx, "Removal cancelled.", "info");
		return noReloadOutcome();
	}

	if (matching.length === 0) {
		notify(ctx, `${source} is not installed.`, "info");
		return noReloadOutcome();
	}

	const targets = buildRemovalTargets(matching, ctx.hasUI, scopeChoice);
	if (targets.length === 0) {
		notify(ctx, "Nothing to remove.", "info");
		return noReloadOutcome();
	}

	const confirmed = await confirmAction(
		ctx,
		"Remove Package",
		`Remove:\n${formatRemovalTargets(targets)}?`,
		UI.longConfirmTimeout,
	);
	if (!confirmed) {
		notify(ctx, "Removal cancelled.", "info");
		return noReloadOutcome();
	}

	const results = await executeRemovalTargets(targets, ctx, pi);
	clearSearchCache();

	const failures = results
		.filter((result): result is RemovalExecutionResult & { success: false; error: string } =>
			Boolean(!result.success && result.error),
		)
		.map((result) => result.error);
	const successfulTargets = results.filter((result) => result.success).map((result) => result.target);

	const remaining = (await getInstalledPackagesAllScopesForRemoval(ctx)).filter(
		(p) => packageIdentity(p.source) === identity,
	);
	notifyRemovalSummary(source, remaining, failures, ctx);

	if (failures.length === 0 && remaining.length === 0) {
		clearUpdatesAvailable(pi, ctx, [identity]);
	}

	const successfulRemovalCount = successfulTargets.length;

	if (successfulRemovalCount === 0) {
		void updateExtmgrStatus(ctx, pi);
		return noReloadOutcome();
	}

	const reloadOutcome = await handleReloadRequirement(ctx, "Removal complete.", reloadMode);
	if (!reloadOutcome.reloaded) {
		void updateExtmgrStatus(ctx, pi);
	}

	return packageMutationOutcome(reloadOutcome);
}

export async function removePackage(source: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	await removePackageInternal(source, ctx, pi);
}

export async function removePackageWithOutcome(
	source: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	reloadMode: ReloadMode = "prompt",
): Promise<PackageMutationOutcome> {
	return removePackageInternal(source, ctx, pi, reloadMode);
}

export async function promptRemove(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	if (!requireUI(ctx, "Interactive package removal")) return;

	const packages = await getInstalledPackages(ctx, pi);
	if (packages.length === 0) {
		notify(ctx, "No packages installed.", "info");
		return;
	}

	const items = packages.map((p: InstalledPackage, index: number) => formatInstalledPackageLabel(p, index));

	const toRemove = await ctx.ui.select("Remove package", items);
	if (!toRemove) return;

	const indexMatch = toRemove.match(/^\[(\d+)\]\s+/);
	const selectedIndex = indexMatch ? Number(indexMatch[1]) - 1 : -1;
	const pkg = selectedIndex >= 0 ? packages[selectedIndex] : undefined;
	if (pkg) {
		await removePackage(pkg.source, ctx, pi);
	}
}

export async function showInstalledPackagesList(ctx: ExtensionCommandContext, _pi: ExtensionAPI): Promise<void> {
	const packages = await getInstalledPackagesAllScopes(ctx);

	if (packages.length === 0) {
		notify(ctx, "No packages installed.", "info");
		return;
	}

	const lines = packages.map((p: InstalledPackage, index: number) => formatInstalledPackageLabel(p, index));

	formatListOutput(ctx, "Installed packages", lines);
}
