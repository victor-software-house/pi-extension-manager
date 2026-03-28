/**
 * Interactive extension manager panel.
 *
 * Pattern: pi-skills-manager custom TUI (Input + manual render loop).
 * - Input for type-ahead search (plain = name, /prefix = path, @prefix = source)
 * - Grouped flat list with group headers
 * - View modes: by-source | a-z | active-first (Tab cycles)
 * - Space/Enter toggles local extension state
 * - a = package actions menu, u = update, x = remove, r = remote browse
 * - After close, prompts reload if local extensions changed
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, rawKeyHint } from "@mariozechner/pi-coding-agent";
import {
	Container,
	getKeybindings,
	Input,
	matchesKey,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import type { ExtensionManagerController } from "../controller.js";
import { discoverExtensions, removeLocalExtension, setExtensionState } from "../extensions/discovery.js";
import { getInstalledPackages } from "../packages/discovery.js";
import { removePackageWithOutcome, updatePackageWithOutcome } from "../packages/management.js";
import type { ExtensionEntry, InstalledPackage, State } from "../types/index.js";
import { logExtensionDelete, logExtensionToggle } from "../utils/history.js";
import { getPackageSourceKind, normalizePackageIdentity } from "../utils/package-source.js";
import { runTaskWithLoader } from "./async-task.js";
import { configurePackageExtensions } from "./package-config.js";
import { showRemote } from "./remote.js";
import { formatSize, getPackageIcon, getScopeIcon, getStatusIcon } from "./theme.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocalItem {
	kind: "local";
	id: string;
	displayName: string;
	summary: string;
	scope: "global" | "project";
	state: State;
	originalState: State;
	activePath: string;
	disabledPath: string;
}

interface PackageItem {
	kind: "package";
	id: string;
	displayName: string;
	summary: string;
	scope: "global" | "project";
	source: string;
	version: string | undefined;
	description: string | undefined;
	size: number | undefined;
	updateAvailable: boolean;
	pkg: InstalledPackage;
}

type Item = LocalItem | PackageItem;

interface Group {
	key: string;
	label: string;
	scope: "global" | "project";
	kind: "local" | "package";
	items: Item[];
}

type FlatEntry = { type: "group"; group: Group } | { type: "item"; item: Item };

type ViewMode = "by-source" | "a-z" | "active-first";
const VIEW_MODES: readonly ViewMode[] = ["by-source", "a-z", "active-first"];
const VIEW_LABELS: Record<ViewMode, string> = {
	"by-source": "By source",
	"a-z": "A\u2013Z",
	"active-first": "Active first",
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadData(ctx: ExtensionCommandContext, pi: ExtensionAPI, controller: ExtensionManagerController) {
	return runTaskWithLoader(
		ctx,
		{ title: "Extension Manager", message: "Loading extensions and packages..." },
		async ({ signal, setMessage }) => {
			const [localEntries, installedPackages] = await Promise.all([
				discoverExtensions(ctx.cwd),
				getInstalledPackages(
					ctx,
					pi,
					(cur, total) => {
						if (total > 0) setMessage(`Loading package metadata... ${cur}/${total}`);
					},
					signal,
				),
			]);
			const knownUpdates = controller.getKnownUpdates(ctx);
			return buildGroups(localEntries, installedPackages, knownUpdates);
		},
	);
}

// ---------------------------------------------------------------------------
// Group building
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
	const n = p.replace(/\\/g, "/");
	return /^[a-zA-Z]:\//.test(n) ? n.toLowerCase() : n;
}

function buildGroups(
	localEntries: ExtensionEntry[],
	installedPackages: InstalledPackage[],
	knownUpdates: Set<string>,
): Group[] {
	// Local extension groups by scope
	const localByScope = new Map<string, LocalItem[]>();
	const localPaths = new Set<string>();

	for (const e of localEntries) {
		localPaths.add(normalizePath(e.activePath));
		const key = `local:${e.scope}`;
		if (!localByScope.has(key)) localByScope.set(key, []);
		const localGroup = localByScope.get(key);
		if (!localGroup) continue;
		localGroup.push({
			kind: "local",
			id: e.id,
			displayName: e.displayName,
			summary: e.summary,
			scope: e.scope,
			state: e.state,
			originalState: e.state,
			activePath: e.activePath,
			disabledPath: e.disabledPath,
		});
	}

	// Package groups — deduplicate against local paths
	const pkgByScope = new Map<string, PackageItem[]>();
	for (const pkg of installedPackages) {
		const srcNorm = normalizePath(pkg.source);
		const resNorm = pkg.resolvedPath ? normalizePath(pkg.resolvedPath) : "";
		const isDup = [...localPaths].some(
			(lp) =>
				srcNorm === lp ||
				resNorm === lp ||
				(resNorm && (lp.startsWith(`${resNorm}/`) || resNorm.startsWith(lp))) ||
				(resNorm && resNorm === lp.split("/").slice(0, -1).join("/")),
		);
		if (isDup) continue;

		const key = `package:${pkg.scope}`;
		if (!pkgByScope.has(key)) pkgByScope.set(key, []);
		const pkgGroup = pkgByScope.get(key);
		if (!pkgGroup) continue;
		pkgGroup.push({
			kind: "package",
			id: `pkg:${pkg.source}`,
			displayName: pkg.name,
			summary: pkg.description ?? `${pkg.source} (${pkg.scope})`,
			scope: pkg.scope,
			source: pkg.source,
			version: pkg.version,
			description: pkg.description,
			size: pkg.size,
			updateAvailable: knownUpdates.has(normalizePackageIdentity(pkg.source)),
			pkg,
		});
	}

	const groups: Group[] = [];

	for (const [key, items] of localByScope) {
		const scope = key.split(":")[1] as "global" | "project";
		groups.push({
			key,
			label: scope === "global" ? "Local extensions (global)" : "Local extensions (project)",
			scope,
			kind: "local",
			items: items.sort((a, b) => a.displayName.localeCompare(b.displayName)),
		});
	}

	for (const [key, items] of pkgByScope) {
		const scope = key.split(":")[1] as "global" | "project";
		groups.push({
			key,
			label: scope === "global" ? "Installed packages (global)" : "Installed packages (project)",
			scope,
			kind: "package",
			items: items.sort((a, b) => a.displayName.localeCompare(b.displayName)),
		});
	}

	// Sort: local before packages, global before project
	groups.sort((a, b) => {
		const kindRank = (k: string) => (k === "local" ? 0 : 1);
		if (a.kind !== b.kind) return kindRank(a.kind) - kindRank(b.kind);
		const scopeRank = (s: string) => (s === "global" ? 0 : 1);
		return scopeRank(a.scope) - scopeRank(b.scope);
	});

	return groups;
}

// ---------------------------------------------------------------------------
// Flat list builders per view mode
// ---------------------------------------------------------------------------

function buildFlatBySource(groups: Group[]): FlatEntry[] {
	const flat: FlatEntry[] = [];
	for (const group of groups) {
		if (group.items.length === 0) continue;
		flat.push({ type: "group", group });
		for (const item of group.items) flat.push({ type: "item", item });
	}
	return flat;
}

function buildFlatAZ(groups: Group[]): FlatEntry[] {
	const allItems: Item[] = groups.flatMap((g) => g.items);
	allItems.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return allItems.map((item) => ({ type: "item" as const, item }));
}

function buildFlatActiveFirst(groups: Group[]): FlatEntry[] {
	const allItems: Item[] = groups.flatMap((g) => g.items);
	const active = allItems.filter((i) => i.kind !== "local" || i.state === "enabled");
	const inactive = allItems.filter((i) => i.kind === "local" && i.state === "disabled");
	active.sort((a, b) => a.displayName.localeCompare(b.displayName));
	inactive.sort((a, b) => a.displayName.localeCompare(b.displayName));
	return [...active, ...inactive].map((item) => ({ type: "item" as const, item }));
}

function buildFlatList(groups: Group[], mode: ViewMode): FlatEntry[] {
	if (mode === "a-z") return buildFlatAZ(groups);
	if (mode === "active-first") return buildFlatActiveFirst(groups);
	return buildFlatBySource(groups);
}

function nextViewMode(current: ViewMode): ViewMode {
	const idx = VIEW_MODES.indexOf(current);
	return VIEW_MODES[(idx + 1) % VIEW_MODES.length] ?? "by-source";
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

function buildMatchFn(query: string): ((item: Item) => boolean) | undefined {
	const trimmed = query.trim();
	if (!trimmed) return undefined;

	if (trimmed.startsWith("@")) {
		const lq = trimmed.slice(1).toLowerCase();
		return (item) => {
			if (item.kind === "package") return item.source.toLowerCase().includes(lq);
			return false;
		};
	}
	if (trimmed.startsWith("/")) {
		const lq = trimmed.slice(1).toLowerCase();
		return (item) => {
			if (item.kind === "local") return item.activePath.toLowerCase().includes(lq);
			if (item.kind === "package") return item.source.toLowerCase().includes(lq);
			return false;
		};
	}
	const lq = trimmed.toLowerCase();
	return (item) => item.displayName.toLowerCase().includes(lq);
}

// ---------------------------------------------------------------------------
// Item rendering
// ---------------------------------------------------------------------------

function renderLocalItem(
	item: LocalItem,
	staged: Map<string, State>,
	selected: boolean,
	theme: ReturnType<typeof Object.create>,
	width: number,
): string {
	const currentState = staged.get(item.id) ?? item.state;
	const changed = staged.has(item.id) && currentState !== item.originalState;
	const cursor = selected ? "> " : "  ";
	const status = getStatusIcon(theme, currentState === "enabled" ? "enabled" : "disabled");
	const scope = getScopeIcon(theme, item.scope);
	const name = selected ? theme.bold(item.displayName) : item.displayName;
	const changeMark = changed ? ` ${theme.fg("warning", "*")}` : "";
	const summary = theme.fg("dim", item.summary);
	return truncateToWidth(`${cursor} ${status} [${scope}] ${name}${changeMark}  ${summary}`, width, "...");
}

function renderPackageItem(
	item: PackageItem,
	selected: boolean,
	theme: ReturnType<typeof Object.create>,
	width: number,
): string {
	const cursor = selected ? "> " : "  ";
	const kind = getPackageSourceKind(item.source);
	const pkgIcon = getPackageIcon(theme, kind === "npm" || kind === "git" || kind === "local" ? kind : "local");
	const scope = getScopeIcon(theme, item.scope);
	const name = selected ? theme.bold(item.displayName) : item.displayName;
	const version = item.version ? theme.fg("dim", `@${item.version}`) : "";
	const updateBadge = item.updateAvailable ? ` ${theme.fg("warning", "[update]")}` : "";
	const infoParts: string[] = [];
	if (item.description) infoParts.push(item.description.slice(0, 40));
	else infoParts.push(kind === "npm" || kind === "git" ? kind : "local");
	if (item.size !== undefined) infoParts.push(formatSize(theme, item.size));
	const summary = theme.fg("dim", infoParts.join(" · "));
	return truncateToWidth(`${cursor} ${pkgIcon} [${scope}] ${name}${version}${updateBadge}  ${summary}`, width, "...");
}

// ---------------------------------------------------------------------------
// Non-interactive fallback
// ---------------------------------------------------------------------------

export async function showListOnly(ctx: ExtensionCommandContext): Promise<void> {
	const entries = await discoverExtensions(ctx.cwd);
	if (entries.length === 0) {
		const msg = "No extensions found in ~/.pi/agent/extensions or .pi/extensions";
		if (ctx.hasUI) ctx.ui.notify(msg, "info");
		else console.log(msg);
		return;
	}
	const lines = entries.map((e) => {
		const status = e.state === "enabled" ? "[x]" : "[ ]";
		return `  ${status} [${e.scope[0]}] ${e.displayName}  ${e.summary}`;
	});
	const out = `Local extensions:\n${lines.join("\n")}`;
	if (ctx.hasUI) ctx.ui.notify(out, "info");
	else console.log(out);
}

// ---------------------------------------------------------------------------
// Panel action type
// ---------------------------------------------------------------------------

type PanelAction =
	| { action: "package-actions"; item: PackageItem }
	| { action: "update"; item: PackageItem }
	| { action: "remove"; item: Item }
	| { action: "remote"; item: undefined };

// ---------------------------------------------------------------------------
// Main interactive panel
// ---------------------------------------------------------------------------

export async function showInteractive(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	controller: ExtensionManagerController,
): Promise<void> {
	if (!ctx.hasUI) {
		await showListOnly(ctx);
		return;
	}

	const groupsOrNull = await loadData(ctx, pi, controller);
	if (!groupsOrNull) {
		await showListOnly(ctx);
		return;
	}

	const groups: Group[] = groupsOrNull;
	const allItems: Item[] = groups.flatMap((g) => g.items);
	if (allItems.length === 0) {
		const choice = await ctx.ui.select("No extensions or packages found", ["Browse community packages", "Cancel"]);
		if (choice === "Browse community packages") await showRemote("", ctx, pi);
		return;
	}

	const staged = new Map<string, State>();
	let changeCount = 0;

	const panelResult = await ctx.ui.custom<PanelAction | undefined>((tui, theme, _kb, done) => {
		const kb = getKeybindings();
		let viewMode: ViewMode = "by-source";
		let masterList: FlatEntry[] = buildFlatList(groups, viewMode);
		let filteredItems: FlatEntry[] = [...masterList];
		let selectedIndex = filteredItems.findIndex((e) => e.type === "item");
		if (selectedIndex < 0) selectedIndex = 0;
		const searchInput = new Input();

		function findNextItem(from: number, dir: number): number {
			let idx = from + dir;
			while (idx >= 0 && idx < filteredItems.length) {
				if (filteredItems[idx]?.type === "item") return idx;
				idx += dir;
			}
			return from;
		}

		function selectFirstItem(): void {
			const idx = filteredItems.findIndex((e) => e.type === "item");
			selectedIndex = idx >= 0 ? idx : 0;
		}

		function applyFilter(query: string): void {
			const matchFn = buildMatchFn(query);
			if (!matchFn) {
				filteredItems = [...masterList];
				selectFirstItem();
				return;
			}
			const matchingItems = new Set<Item>();
			const matchingGroups = new Set<Group>();
			for (const entry of masterList) {
				if (entry.type === "item" && matchFn(entry.item)) matchingItems.add(entry.item);
			}
			for (const group of groups) {
				for (const item of group.items) {
					if (matchingItems.has(item)) matchingGroups.add(group);
				}
			}
			filteredItems = masterList.filter(
				(e) => (e.type === "group" && matchingGroups.has(e.group)) || (e.type === "item" && matchingItems.has(e.item)),
			);
			selectFirstItem();
		}

		function rebuildForMode(): void {
			masterList = buildFlatList(groups, viewMode);
			applyFilter(searchInput.getValue());
		}

		// --- Header ---
		const header = {
			invalidate() {},
			render(width: number): string[] {
				const title = theme.bold("Extension Manager");
				const sep = theme.fg("muted", " \u00b7 ");
				const hint =
					rawKeyHint("space", "toggle") +
					sep +
					rawKeyHint("a", "actions") +
					sep +
					rawKeyHint("tab", "view") +
					sep +
					rawKeyHint("esc", "close");
				const hintWidth = visibleWidth(hint);
				const titleWidth = visibleWidth(title);
				const spacing = Math.max(1, width - titleWidth - hintWidth);
				return [
					truncateToWidth(`${title}${" ".repeat(spacing)}${hint}`, width, ""),
					theme.fg(
						"muted",
						`Filter: name \u00b7 /path \u00b7 @source  \u00b7  r remote  \u00b7  u update  \u00b7  x remove`,
					),
				];
			},
		};

		const maxVisible = 20;

		// --- List ---
		const list = {
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];
				lines.push(...searchInput.render(width));
				lines.push("");

				if (filteredItems.length === 0) {
					lines.push(theme.fg("muted", "  No results"));
					return lines;
				}

				const startIndex = Math.max(
					0,
					Math.min(selectedIndex - Math.floor(maxVisible / 2), filteredItems.length - maxVisible),
				);
				const endIndex = Math.min(startIndex + maxVisible, filteredItems.length);

				for (let i = startIndex; i < endIndex; i++) {
					const entry = filteredItems[i];
					if (!entry) continue;
					const isSelected = i === selectedIndex;

					if (entry.type === "group") {
						lines.push(truncateToWidth(`  ${theme.fg("accent", theme.bold(entry.group.label))}`, width, ""));
					} else if (entry.item.kind === "local") {
						lines.push(renderLocalItem(entry.item, staged, isSelected, theme, width));
					} else {
						lines.push(renderPackageItem(entry.item, isSelected, theme, width));
					}
				}

				// Footer counter + view mode
				const itemCount = filteredItems.filter((e) => e.type === "item").length;
				const itemIndex = filteredItems.slice(0, selectedIndex + 1).filter((e) => e.type === "item").length;
				const modeLabel = VIEW_LABELS[viewMode];
				const hasScroll = startIndex > 0 || endIndex < filteredItems.length;
				lines.push(theme.fg("dim", `  ${hasScroll ? `${itemIndex}/${itemCount} ` : ""}${modeLabel}`));

				return lines;
			},
		};

		// --- Container ---
		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());
		container.addChild(new Spacer(1));
		container.addChild(header);
		container.addChild(new Spacer(1));
		container.addChild(list);
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder());

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data: string) {
				// 1. Navigation
				if (kb.matches(data, "tui.select.up")) {
					selectedIndex = findNextItem(selectedIndex, -1);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.down")) {
					selectedIndex = findNextItem(selectedIndex, 1);
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.pageUp")) {
					let t = Math.max(0, selectedIndex - maxVisible);
					while (t < filteredItems.length && filteredItems[t]?.type !== "item") t++;
					if (t < filteredItems.length) selectedIndex = t;
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.select.pageDown")) {
					let t = Math.min(filteredItems.length - 1, selectedIndex + maxVisible);
					while (t >= 0 && filteredItems[t]?.type !== "item") t--;
					if (t >= 0) selectedIndex = t;
					tui.requestRender();
					return;
				}

				// 2. Cancel
				if (kb.matches(data, "tui.select.cancel") || matchesKey(data, "ctrl+c")) {
					done(undefined);
					return;
				}

				// 3. View mode
				if (matchesKey(data, "tab")) {
					viewMode = nextViewMode(viewMode);
					rebuildForMode();
					tui.requestRender();
					return;
				}

				// 4. Toggle / actions on selected item
				const selectedEntry = filteredItems[selectedIndex];
				const selectedItem = selectedEntry?.type === "item" ? selectedEntry.item : undefined;

				if (data === " " || kb.matches(data, "tui.select.confirm")) {
					if (selectedItem?.kind === "local") {
						const current = staged.get(selectedItem.id) ?? selectedItem.state;
						const next: State = current === "enabled" ? "disabled" : "enabled";
						staged.set(selectedItem.id, next);
						selectedItem.state = next;
						// Update canonical group state for view rebuilds
						for (const group of groups) {
							const found = group.items.find((i) => i.id === selectedItem.id);
							if (found?.kind === "local") found.state = next;
						}
						changeCount++;
						if (viewMode === "active-first") rebuildForMode();
					} else if (selectedItem?.kind === "package") {
						// Enter on package opens actions
						done({ action: "package-actions", item: selectedItem });
						return;
					}
					tui.requestRender();
					return;
				}

				if ((data === "a" || data === "A") && selectedItem?.kind === "package") {
					done({ action: "package-actions", item: selectedItem });
					return;
				}

				if ((data === "u" || data === "U") && selectedItem?.kind === "package") {
					done({ action: "update", item: selectedItem });
					return;
				}

				if ((data === "x" || data === "X") && selectedItem) {
					done({ action: "remove", item: selectedItem });
					return;
				}

				if (data === "r" || data === "R") {
					done({ action: "remote", item: undefined });
					return;
				}

				// 5. Fall through to search
				searchInput.handleInput(data);
				applyFilter(searchInput.getValue());
				tui.requestRender();
			},
		};
	});

	// Handle action signaled by the panel
	if (panelResult) {
		// First apply any pending staged changes (no reload prompt — we'll continue)
		if (staged.size > 0) {
			await applyStaged(staged, allItems, pi);
		}

		if (panelResult.action === "remote") {
			await showRemote("", ctx, pi);
			return;
		}

		if (panelResult.action === "update") {
			const outcome = await updatePackageWithOutcome(panelResult.item.source, ctx, pi);
			if (outcome.reloaded) return;
			return;
		}

		if (panelResult.action === "remove" && panelResult.item.kind === "package") {
			const outcome = await removePackageWithOutcome(panelResult.item.source, ctx, pi);
			if (outcome.reloaded) return;
			return;
		}

		if (panelResult.action === "remove" && panelResult.item.kind === "local") {
			const item = panelResult.item;
			const confirmed = await ctx.ui.confirm(
				"Delete Extension",
				`Delete ${item.displayName} from disk? This cannot be undone.`,
			);
			if (!confirmed) return;
			const removal = await removeLocalExtension(
				{ activePath: item.activePath, disabledPath: item.disabledPath },
				ctx.cwd,
			);
			if (!removal.ok) {
				logExtensionDelete(pi, item.id, false, removal.error);
				ctx.ui.notify(`Failed to remove extension: ${removal.error}`, "error");
				return;
			}
			logExtensionDelete(pi, item.id, true);
			ctx.ui.notify(`Removed ${item.displayName}.`, "info");
			const reload = await ctx.ui.confirm("Reload Required", "Extension removed. Reload pi now?");
			if (reload) {
				await ctx.reload();
				return;
			}
			return;
		}

		if (panelResult.action === "package-actions") {
			const item = panelResult.item;
			const choice = await ctx.ui.select(item.displayName, [
				"Configure extensions",
				"Update",
				"Remove",
				"Details",
				"Cancel",
			]);
			if (!choice || choice === "Cancel") return;
			if (choice === "Configure extensions") {
				await configurePackageExtensions(item.pkg, ctx, pi);
			} else if (choice === "Update") {
				const outcome = await updatePackageWithOutcome(item.source, ctx, pi);
				if (outcome.reloaded) return;
			} else if (choice === "Remove") {
				const outcome = await removePackageWithOutcome(item.source, ctx, pi);
				if (outcome.reloaded) return;
			} else if (choice === "Details") {
				const parts = [
					`Name: ${item.displayName}`,
					`Version: ${item.version ?? "unknown"}`,
					`Source: ${item.source}`,
					`Scope: ${item.scope}`,
				];
				if (item.size !== undefined) parts.push(`Size: ${formatSize(ctx.ui.theme, item.size)}`);
				if (item.description) parts.push(`Description: ${item.description}`);
				ctx.ui.notify(parts.join("\n"), "info");
			}
		}
		return;
	}

	// Panel closed normally — apply staged changes
	if (changeCount > 0 || staged.size > 0) {
		await applyStaged(staged, allItems, pi);
		const changed = [...staged.entries()].filter(([id]) => {
			const item = allItems.find((i) => i.id === id);
			return item?.kind === "local" && item.originalState !== staged.get(id);
		}).length;
		if (changed > 0) {
			const reload = await ctx.ui.confirm("Reload Required", `${changed} extension change(s) saved. Reload pi now?`);
			if (reload) {
				await ctx.reload();
				return;
			}
			ctx.ui.notify("Changes saved. Use /reload to apply.", "info");
		}
	}
}

// ---------------------------------------------------------------------------
// Action handlers (called after panel closes with an action)
// ---------------------------------------------------------------------------

async function applyStaged(staged: Map<string, State>, allItems: Item[], pi: ExtensionAPI): Promise<void> {
	for (const [id, targetState] of staged) {
		const item = allItems.find((i) => i.id === id);
		if (!item || item.kind !== "local") continue;
		if (targetState === item.originalState) continue;
		const result = await setExtensionState(
			{ activePath: item.activePath, disabledPath: item.disabledPath },
			targetState,
		);
		if (result.ok) {
			logExtensionToggle(pi, id, item.originalState, targetState, true);
		} else {
			logExtensionToggle(pi, id, item.originalState, targetState, false, result.error);
		}
	}
}

// ---------------------------------------------------------------------------
// Legacy re-exports for registry compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use showInteractive with controller */
export async function showInstalledPackagesLegacy(ctx: ExtensionCommandContext, _pi: ExtensionAPI): Promise<void> {
	ctx.ui.notify("Use /extensions to open the unified extension manager.", "info");
}
