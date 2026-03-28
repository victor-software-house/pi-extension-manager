/**
 * Package extension configuration panel.
 */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, type SettingItem, SettingsList, Spacer, Text } from "@mariozechner/pi-tui";
import { UI } from "../constants.js";
import {
	applyPackageExtensionStateChanges,
	discoverPackageExtensions,
	validatePackageExtensionSettings,
} from "../packages/extensions.js";
import type { InstalledPackage, PackageExtensionEntry, State } from "../types/index.js";
import { fileExists } from "../utils/fs.js";
import { logExtensionToggle } from "../utils/history.js";

import { notify } from "../utils/notify.js";
import { getPackageSourceKind } from "../utils/package-source.js";
import type { ReloadMode } from "../utils/ui-helpers.js";

import { runTaskWithLoader } from "./async-task.js";
import { getChangeMarker, getPackageIcon, getScopeIcon, getStatusIcon } from "./theme.js";

export interface PackageConfigRow {
	id: string;
	extensionPath: string;
	summary: string;
	originalState: State;
	available: boolean;
}

interface PackageConfigOptions {
	restartMode?: ReloadMode;
}

type ConfigurePanelAction = { type: "cancel" } | { type: "save" };

export async function buildPackageConfigRows(entries: PackageExtensionEntry[]): Promise<PackageConfigRow[]> {
	const dedupedEntries = new Map<string, PackageExtensionEntry>();
	for (const entry of entries) {
		if (!dedupedEntries.has(entry.extensionPath)) {
			dedupedEntries.set(entry.extensionPath, entry);
		}
	}

	const rows = await Promise.all(
		Array.from(dedupedEntries.values()).map(async (entry) => ({
			id: entry.id,
			extensionPath: entry.extensionPath,
			summary: entry.summary,
			originalState: entry.state,
			available: await fileExists(entry.absolutePath),
		})),
	);

	rows.sort((a, b) => a.extensionPath.localeCompare(b.extensionPath));
	return rows;
}

function formatConfigRowLabel(
	row: PackageConfigRow,
	state: State,
	pkg: InstalledPackage,
	theme: Theme,
	changed: boolean,
): string {
	const statusIcon = getStatusIcon(theme, state);
	const scopeIcon = getScopeIcon(theme, pkg.scope);
	const sourceKind = getPackageSourceKind(pkg.source);
	const pkgIcon = getPackageIcon(
		theme,
		sourceKind === "npm" || sourceKind === "git" || sourceKind === "local" ? sourceKind : "local",
	);
	const changeMarker = getChangeMarker(theme, changed);
	const name = theme.bold(row.extensionPath);
	const availability = row.available
		? ""
		: ` ${theme.fg("warning", "[missing]")}${theme.fg("dim", " (cannot toggle)")}`;
	const summary = theme.fg("dim", row.summary);

	return `${statusIcon} ${pkgIcon} [${scopeIcon}] ${name}${availability} - ${summary}${changeMarker}`;
}

function buildSettingItems(
	rows: PackageConfigRow[],
	staged: Map<string, State>,
	pkg: InstalledPackage,
	theme: Theme,
): SettingItem[] {
	return rows.map((row) => {
		const current = staged.get(row.id) ?? row.originalState;
		const changed = current !== row.originalState;

		return {
			id: row.id,
			label: formatConfigRowLabel(row, current, pkg, theme, changed),
			currentValue: current,
			values: row.available ? ["enabled", "disabled"] : [current],
		};
	});
}

function getPendingChangeCount(rows: PackageConfigRow[], staged: Map<string, State>): number {
	let count = 0;

	for (const row of rows) {
		const target = staged.get(row.id);
		if (!target) continue;
		if (target !== row.originalState) count += 1;
	}

	return count;
}

async function showConfigurePanel(
	pkg: InstalledPackage,
	rows: PackageConfigRow[],
	staged: Map<string, State>,
	ctx: ExtensionCommandContext,
): Promise<ConfigurePanelAction | undefined> {
	if (!ctx.hasUI) return undefined;
	return ctx.ui.custom<ConfigurePanelAction>((tui, theme, _keybindings, done) => {
		const container = new Container();
		const titleText = new Text("", 2, 0);
		const subtitleText = new Text("", 2, 0);
		const footerText = new Text("", 2, 0);

		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(titleText);
		container.addChild(subtitleText);
		container.addChild(new Spacer(1));

		const settingsItems = buildSettingItems(rows, staged, pkg, theme);
		const rowById = new Map(rows.map((row) => [row.id, row]));
		const syncThemedContent = (): void => {
			titleText.setText(theme.fg("accent", theme.bold(`Configure extensions: ${pkg.name}`)));
			subtitleText.setText(
				theme.fg(
					"muted",
					`${rows.length} extension path${rows.length === 1 ? "" : "s"} • Space/Enter toggle • S save • Esc cancel`,
				),
			);
			footerText.setText(theme.fg("dim", "↑↓ Navigate | Space/Enter Toggle | S Save | Esc Back"));

			for (const settingsItem of settingsItems) {
				const row = rowById.get(settingsItem.id);
				if (!row) continue;
				const currentState = staged.get(row.id) ?? row.originalState;
				settingsItem.label = formatConfigRowLabel(row, currentState, pkg, theme, currentState !== row.originalState);
			}
		};
		syncThemedContent();

		const settingsList = new SettingsList(
			settingsItems,
			Math.min(rows.length + 2, UI.maxListHeight),
			getSettingsListTheme(),
			(id: string, newValue: string) => {
				const row = rowById.get(id);
				if (!row?.available) return;

				const state = newValue as State;
				staged.set(id, state);

				const settingsItem = settingsItems.find((item) => item.id === id);
				if (settingsItem) {
					settingsItem.label = formatConfigRowLabel(row, state, pkg, theme, state !== row.originalState);
				}

				tui.requestRender();
			},
			() => done({ type: "cancel" }),
		);

		container.addChild(settingsList);
		container.addChild(new Spacer(1));
		container.addChild(footerText);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
				syncThemedContent();
			},
			handleInput(data: string) {
				if (matchesKey(data, "ctrl+s") || data === "s" || data === "S") {
					done({ type: "save" });
					return;
				}
				settingsList.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}

export async function applyPackageExtensionChanges(
	rows: PackageConfigRow[],
	staged: Map<string, State>,
	pkg: InstalledPackage,
	cwd: string,
	pi: ExtensionAPI,
): Promise<{ changed: number; errors: string[] }> {
	const errors: string[] = [];
	const changedRows = [...rows]
		.sort((a, b) => a.extensionPath.localeCompare(b.extensionPath))
		.flatMap((row) => {
			const target = staged.get(row.id) ?? row.originalState;
			if (target === row.originalState) {
				return [];
			}

			if (!row.available) {
				const error = `${row.extensionPath}: extension entrypoint is missing on disk`;
				errors.push(error);
				logExtensionToggle(pi, row.id, row.originalState, target, false, error);
				return [];
			}

			return [{ row, target }];
		});

	if (changedRows.length === 0) {
		return { changed: 0, errors };
	}

	const result = await applyPackageExtensionStateChanges(
		pkg.source,
		pkg.scope,
		changedRows.map(({ row, target }) => ({ extensionPath: row.extensionPath, target })),
		cwd,
	);

	if (!result.ok) {
		for (const { row, target } of changedRows) {
			const error = `${row.extensionPath}: ${result.error}`;
			errors.push(error);
			logExtensionToggle(pi, row.id, row.originalState, target, false, result.error);
		}
		return { changed: 0, errors };
	}

	for (const { row, target } of changedRows) {
		logExtensionToggle(pi, row.id, row.originalState, target, true);
	}

	return { changed: changedRows.length, errors };
}

async function promptRestartForPackageConfig(ctx: ExtensionCommandContext): Promise<boolean> {
	if (!ctx.hasUI) {
		notify(ctx, "Restart pi to apply package extension configuration changes. /reload may not be enough.", "warning");
		return false;
	}

	const restartNow = await ctx.ui.confirm(
		"Restart Required",
		"Package extension configuration changed.\nA full pi restart is required to apply it.\nExit pi now?",
	);

	if (!restartNow) {
		notify(
			ctx,
			"Restart pi manually to apply package extension configuration changes. /reload may not be enough.",
			"warning",
		);
		return false;
	}

	notify(ctx, "Shutting down pi. Start it again to apply changes.", "info");
	ctx.shutdown();
	return true;
}

export async function configurePackageExtensions(
	pkg: InstalledPackage,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	options?: PackageConfigOptions,
): Promise<{ changed: number; reloaded: boolean; restartRequired: boolean }> {
	if (!ctx.hasUI) {
		notify(ctx, "Package extension configuration requires interactive mode.", "warning");
		return { changed: 0, reloaded: false, restartRequired: false };
	}

	const validation = await validatePackageExtensionSettings(pkg.scope, ctx.cwd);
	if (!validation.ok) {
		notify(ctx, validation.error, "error");
		return { changed: 0, reloaded: false, restartRequired: false };
	}

	let initialData: { rows: PackageConfigRow[] } | undefined;
	try {
		initialData = await runTaskWithLoader(
			ctx,
			{
				title: `Configure ${pkg.name}`,
				message: "Discovering package extensions...",
				cancellable: false,
			},
			async () => {
				const discovered = await discoverPackageExtensions([pkg], ctx.cwd);
				const rows = await buildPackageConfigRows(discovered);
				return { rows };
			},
		);
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "error");
		return { changed: 0, reloaded: false, restartRequired: false };
	}

	if (!initialData) {
		notify(ctx, "Package extension configuration requires the full interactive TUI.", "warning");
		return { changed: 0, reloaded: false, restartRequired: false };
	}

	const { rows } = initialData;

	if (rows.length === 0) {
		notify(ctx, "No configurable extensions discovered for this package.", "info");
		return { changed: 0, reloaded: false, restartRequired: false };
	}

	const staged = new Map<string, State>();

	while (true) {
		const action = await showConfigurePanel(pkg, rows, staged, ctx);
		if (!action) {
			return { changed: 0, reloaded: false, restartRequired: false };
		}

		if (action.type === "cancel") {
			const pending = getPendingChangeCount(rows, staged);
			if (pending === 0) {
				return { changed: 0, reloaded: false, restartRequired: false };
			}

			const choice = await ctx.ui.select(`Unsaved changes (${pending})`, [
				"Save and back",
				"Discard changes",
				"Stay in configure",
			]);

			if (!choice || choice === "Stay in configure") {
				continue;
			}

			if (choice === "Discard changes") {
				return { changed: 0, reloaded: false, restartRequired: false };
			}
		}

		const apply = await applyPackageExtensionChanges(rows, staged, pkg, ctx.cwd, pi);

		if (apply.errors.length > 0) {
			notify(
				ctx,
				`Applied ${apply.changed} change(s), ${apply.errors.length} failed.\n${apply.errors.join("\n")}`,
				"warning",
			);
		} else if (apply.changed === 0) {
			notify(ctx, "No changes to apply.", "info");
			return { changed: 0, reloaded: false, restartRequired: false };
		} else {
			notify(ctx, `Applied ${apply.changed} package extension change(s).`, "info");
		}

		if (apply.changed === 0) {
			return { changed: 0, reloaded: false, restartRequired: false };
		}

		if (options?.restartMode === "defer") {
			return { changed: apply.changed, reloaded: false, restartRequired: true };
		}

		const restarted = await promptRestartForPackageConfig(ctx);
		return { changed: apply.changed, reloaded: restarted, restartRequired: !restarted };
	}
}
