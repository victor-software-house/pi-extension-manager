/**
 * Remote package browsing UI
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { CACHE_LIMITS, PAGE_SIZE, TIMEOUTS } from "../constants.js";
import { getSearchCache, isCacheValid, searchNpmPackages, setSearchCache } from "../packages/discovery.js";
import { installPackage, installPackageLocally } from "../packages/install.js";
import type { NpmPackage } from "../types/index.js";
import { parseChoiceByLabel, splitCommandArgs } from "../utils/command.js";
import { formatBytes, truncate } from "../utils/format.js";
import { notify } from "../utils/notify.js";
import { execNpm } from "../utils/npm-exec.js";
import { noReloadOutcome, type ReloadMode, type ReloadOutcome } from "../utils/ui-helpers.js";
import { runTaskWithLoader } from "./async-task.js";

interface RemoteOptions {
	reloadMode?: ReloadMode;
}

interface PackageInfoCacheEntry {
	timestamp: number;
	text: string;
}

interface NpmViewInfo {
	description?: string;
	version?: string;
	author?: { name?: string } | string;
	homepage?: string;
	users?: Record<string, boolean>;
	dist?: { unpackedSize?: number };
	repository?: { url?: string } | string;
}

interface NpmDownloadsPoint {
	downloads?: number;
}

// LRU Cache with size limit to prevent memory leaks
class PackageInfoCache {
	private cache = new Map<string, PackageInfoCacheEntry>();
	private readonly maxSize: number;
	private readonly ttl: number;

	constructor(maxSize: number, ttl: number) {
		this.maxSize = maxSize;
		this.ttl = ttl;
	}

	get(name: string): PackageInfoCacheEntry | undefined {
		const entry = this.cache.get(name);
		if (!entry) return undefined;

		// Check if expired
		if (Date.now() - entry.timestamp > this.ttl) {
			this.cache.delete(name);
			return undefined;
		}

		// Move to end (most recently used)
		this.cache.delete(name);
		this.cache.set(name, entry);
		return entry;
	}

	set(name: string, entry: Omit<PackageInfoCacheEntry, "timestamp">): void {
		if (this.cache.has(name)) {
			this.cache.delete(name);
		} else if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(name, {
			...entry,
			timestamp: Date.now(),
		});
	}

	clear(): void {
		this.cache.clear();
	}
}

// Global LRU cache instance
const packageInfoCache = new PackageInfoCache(CACHE_LIMITS.packageInfoMaxSize, CACHE_LIMITS.packageInfoTTL);

export function clearRemotePackageInfoCache(): void {
	packageInfoCache.clear();
}

type BrowseAction =
	| { type: "package"; name: string }
	| { type: "prev" }
	| { type: "next" }
	| { type: "refresh" }
	| { type: "menu" }
	| { type: "cancel" };

const REMOTE_MENU_CHOICES = {
	browse: "Browse pi packages",
	search: "Search packages",
	install: "Install by source",
} as const;

const PACKAGE_DETAILS_CHOICES = {
	installManaged: "Install via npm (managed)",
	installStandalone: "Install locally (standalone)",
	viewInfo: "View npm info",
	back: "Back to results",
} as const;

function createAbortError(): Error {
	const error = new Error("Operation cancelled");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

function formatCount(value: number | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
	return new Intl.NumberFormat().format(value);
}

async function fetchWeeklyDownloads(packageName: string, signal?: AbortSignal): Promise<number | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUTS.weeklyDownloads);
	const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

	try {
		const encoded = encodeURIComponent(packageName);
		const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encoded}`, {
			signal: combinedSignal,
		});

		if (!res.ok) return undefined;
		const data = (await res.json()) as NpmDownloadsPoint;
		return typeof data.downloads === "number" ? data.downloads : undefined;
	} catch (error) {
		if (signal?.aborted && error instanceof Error && error.name === "AbortError") {
			throw error;
		}
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function buildPackageInfoText(
	packageName: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<string> {
	// Check cache first
	const cached = packageInfoCache.get(packageName);
	if (cached) {
		return cached.text;
	}

	const [infoRes, weeklyDownloads] = await Promise.all([
		execNpm(pi, ["view", packageName, "--json"], ctx, {
			timeout: TIMEOUTS.npmView,
			...(signal ? { signal } : {}),
		}),
		fetchWeeklyDownloads(packageName, signal),
	]);

	throwIfAborted(signal);

	if (infoRes.code !== 0) {
		throw new Error(infoRes.stderr || infoRes.stdout || `npm view failed (exit ${infoRes.code})`);
	}

	const info = JSON.parse(infoRes.stdout) as NpmViewInfo;
	const description = info.description ?? "No description";
	const version = info.version ?? "unknown";
	const author = typeof info.author === "object" ? info.author?.name : (info.author ?? "unknown");
	const homepage = info.homepage ?? "";
	const stars = info.users ? Object.keys(info.users).length : undefined;
	const unpackedSize = info.dist?.unpackedSize;
	const repository = typeof info.repository === "string" ? info.repository : info.repository?.url;

	const lines = [
		`${packageName}@${version}`,
		description,
		`Author: ${author}`,
		`Weekly downloads: ${formatCount(weeklyDownloads)}`,
		`Stars: ${formatCount(stars)}`,
		`Unpacked size: ${typeof unpackedSize === "number" ? formatBytes(unpackedSize) : "unknown"}`,
	];

	if (homepage) lines.push(`Homepage: ${homepage}`);
	if (repository) lines.push(`Repository: ${repository}`);

	const text = lines.join("\n");

	throwIfAborted(signal);
	packageInfoCache.set(packageName, { text });

	return text;
}

export async function showRemote(
	args: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	const { subcommand: sub, args: rest } = splitCommandArgs(args);
	const query = rest.join(" ").trim();

	switch (sub) {
		case "list":
		case "installed":
			// Legacy: redirect to unified view
			ctx.ui.notify("Use /extensions for the unified view.", "info");
			return noReloadOutcome();
		case "install":
			if (query) {
				return installPackage(query, ctx, pi, options?.reloadMode ? { reloadMode: options.reloadMode } : undefined);
			} else {
				return promptInstall(ctx, pi, options);
			}
		case "search":
			return searchPackages(query, ctx, pi, options);
		case "browse":
		case "":
			return browseRemotePackages(ctx, "keywords:pi-package", pi, 0, options);
	}

	// Show remote menu
	return showRemoteMenu(ctx, pi, options);
}

async function showRemoteMenu(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	if (!ctx.hasUI) return noReloadOutcome();

	const choice = parseChoiceByLabel(
		REMOTE_MENU_CHOICES,
		await ctx.ui.select("Community Packages", Object.values(REMOTE_MENU_CHOICES)),
	);

	switch (choice) {
		case "browse":
			return browseRemotePackages(ctx, "keywords:pi-package", pi, 0, options);
		case "search":
			return promptSearch(ctx, pi, options);
		case "install":
			return promptInstall(ctx, pi, options);
		default:
			return noReloadOutcome();
	}
}

async function selectBrowseAction(
	ctx: ExtensionCommandContext,
	titleText: string,
	packages: NpmPackage[],
	offset: number,
	totalResults: number,
	showPrevious: boolean,
	showLoadMore: boolean,
): Promise<BrowseAction | undefined> {
	if (!ctx.hasUI) return undefined;

	const items: SelectItem[] = packages.map((p) => ({
		value: `pkg:${p.name}`,
		label: `${p.name}${p.version ? ` @${p.version}` : ""}`,
		description: truncateToWidth(p.description || "No description", 35),
	}));

	if (showPrevious) {
		items.push({ value: "nav:prev", label: "◀  Previous page" });
	}
	if (showLoadMore) {
		items.push({
			value: "nav:next",
			label: `▶  Next page (${offset + 1}-${offset + packages.length} of ${totalResults})`,
		});
	}
	items.push({ value: "nav:refresh", label: "Refresh search" });
	items.push({ value: "nav:menu", label: "← Back to menu" });

	if (!ctx.hasUI) return undefined;
	return ctx.ui.custom<BrowseAction>((tui, theme, _keybindings, done) => {
		const container = new Container();
		const title = new Text("", 1, 0);
		const footer = new Text("", 1, 0);
		const syncThemedContent = (): void => {
			title.setText(theme.fg("accent", theme.bold(titleText)));
			footer.setText(theme.fg("dim", "↑↓ wraps • enter select • esc cancel"));
		};

		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(title);

		const selectList = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		});

		selectList.onSelect = (item) => {
			if (item.value === "nav:prev") {
				done({ type: "prev" });
			} else if (item.value === "nav:next") {
				done({ type: "next" });
			} else if (item.value === "nav:refresh") {
				done({ type: "refresh" });
			} else if (item.value === "nav:menu") {
				done({ type: "menu" });
			} else if (item.value.startsWith("pkg:")) {
				done({ type: "package", name: item.value.slice(4) });
			} else {
				done({ type: "cancel" });
			}
		};

		selectList.onCancel = () => done({ type: "cancel" });

		syncThemedContent();
		container.addChild(selectList);
		container.addChild(footer);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => {
				container.invalidate();
				syncThemedContent();
			},
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

export async function browseRemotePackages(
	ctx: ExtensionCommandContext,
	query: string,
	pi: ExtensionAPI,
	offset = 0,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	if (!ctx.hasUI) {
		notify(ctx, "Remote package browsing requires interactive mode. Use: /extensions install <source>", "warning");
		return noReloadOutcome();
	}

	let allPackages: NpmPackage[] | undefined;

	if (isCacheValid(query)) {
		const cache = getSearchCache();
		if (cache) {
			allPackages = cache.results;
		}
	}

	if (!allPackages) {
		const results = await runTaskWithLoader(
			ctx,
			{
				title: "Remote Packages",
				message: `Searching npm for ${truncate(query, 40)}...`,
			},
			async ({ signal, setMessage }) => {
				setMessage(`Searching npm for ${truncate(query, 40)}...`);
				return searchNpmPackages(query, ctx, { signal });
			},
		);

		if (!results) {
			notify(ctx, "Remote package search was cancelled.", "info");
			return noReloadOutcome();
		}

		allPackages = results;
		setSearchCache({
			query,
			results: allPackages,
			timestamp: Date.now(),
		});
	}

	// Apply pagination from cached/filtered results
	const totalResults = allPackages.length;
	const packages = allPackages.slice(offset, offset + PAGE_SIZE);

	if (packages.length === 0) {
		const msg = offset > 0 ? "No more packages to show." : `No packages found for: ${query}`;
		ctx.ui.notify(msg, "info");

		if (offset > 0) {
			return browseRemotePackages(ctx, query, pi, 0, options);
		}
		return noReloadOutcome();
	}

	// Add navigation options
	const showLoadMore = totalResults >= PAGE_SIZE && offset + PAGE_SIZE < totalResults;
	const showPrevious = offset > 0;

	const titleText =
		offset > 0
			? `Search Results (${offset + 1}-${offset + packages.length} of ${totalResults})`
			: `Search: ${truncate(query, 40)} (${totalResults})`;

	const result = await selectBrowseAction(ctx, titleText, packages, offset, totalResults, showPrevious, showLoadMore);

	if (!result || result.type === "cancel") {
		return noReloadOutcome();
	}

	// Handle result
	switch (result.type) {
		case "prev":
			return browseRemotePackages(ctx, query, pi, Math.max(0, offset - PAGE_SIZE), options);
		case "next":
			return browseRemotePackages(ctx, query, pi, offset + PAGE_SIZE, options);
		case "refresh":
			setSearchCache(null);
			return browseRemotePackages(ctx, query, pi, 0, options);
		case "menu":
			return showRemoteMenu(ctx, pi, options);
		case "package":
			return showPackageDetails(result.name, ctx, pi, query, offset, options);
	}
}

async function showPackageDetails(
	packageName: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	previousQuery: string,
	previousOffset: number,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	if (!ctx.hasUI) {
		console.log(`Package: ${packageName}`);
		return noReloadOutcome();
	}

	const choice = parseChoiceByLabel(
		PACKAGE_DETAILS_CHOICES,
		await ctx.ui.select(packageName, Object.values(PACKAGE_DETAILS_CHOICES)),
	);

	switch (choice) {
		case "installManaged":
			return installPackage(
				`npm:${packageName}`,
				ctx,
				pi,
				options?.reloadMode ? { reloadMode: options.reloadMode } : undefined,
			);
		case "installStandalone":
			return installPackageLocally(
				packageName,
				ctx,
				pi,
				options?.reloadMode ? { reloadMode: options.reloadMode } : undefined,
			);
		case "viewInfo":
			try {
				const text = await runTaskWithLoader(
					ctx,
					{
						title: packageName,
						message: `Fetching package details for ${packageName}...`,
					},
					({ signal }) => buildPackageInfoText(packageName, ctx, pi, signal),
				);

				if (!text) {
					notify(ctx, `Loading ${packageName} details was cancelled.`, "info");
					return showPackageDetails(packageName, ctx, pi, previousQuery, previousOffset, options);
				}

				ctx.ui.notify(text, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Package: ${packageName}\n${message}`, "warning");
			}
			return showPackageDetails(packageName, ctx, pi, previousQuery, previousOffset, options);
		case "back":
			return browseRemotePackages(ctx, previousQuery, pi, previousOffset, options);
		default:
			return noReloadOutcome();
	}
}

async function promptSearch(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	const query = await ctx.ui.input("Search packages", "keywords:pi-package");
	if (!query?.trim()) return noReloadOutcome();
	return searchPackages(query.trim(), ctx, pi, options);
}

async function searchPackages(
	query: string,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	if (!query) {
		return promptSearch(ctx, pi, options);
	}
	return browseRemotePackages(ctx, query, pi, 0, options);
}

async function promptInstall(
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
	options?: RemoteOptions,
): Promise<ReloadOutcome> {
	if (!ctx.hasUI) {
		notify(
			ctx,
			"Interactive input not available in non-interactive mode.\nUsage: /extensions install <npm:package|git:url|path>",
			"warning",
		);
		return noReloadOutcome();
	}
	const source = await ctx.ui.input("Install package", "npm:@scope/pkg or git:https://...");
	if (!source) return noReloadOutcome();
	return installPackage(source.trim(), ctx, pi, options?.reloadMode ? { reloadMode: options.reloadMode } : undefined);
}
