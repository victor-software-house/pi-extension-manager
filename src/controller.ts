/**
 * ExtensionManagerController — owns all mutable runtime state.
 *
 * Eliminates module-level singletons by co-locating:
 *   - auto-update config (read/write + session hydration)
 *   - background timer lifecycle
 *   - runtime status (last known packages, update availability)
 *   - package catalog access
 *
 * One instance is created in index.ts and passed down to all subsystems.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getPackageCatalog } from "./packages/catalog.js";
import { logAutoUpdateConfig } from "./utils/history.js";
import { notify } from "./utils/notify.js";
import { normalizePackageIdentity } from "./utils/package-source.js";
import {
	type AutoUpdateConfig,
	calculateNextCheck,
	clearUpdatesAvailable,
	getAutoUpdateConfig,
	getAutoUpdateConfigAsync,
	getScheduleInterval,
	hydrateAutoUpdateConfig,
	parseDuration,
	saveAutoUpdateConfig,
} from "./utils/settings.js";

// ---------------------------------------------------------------------------
// Timer — scoped to controller instance (no module-level state)
// ---------------------------------------------------------------------------

interface TimerState {
	intervalId: ReturnType<typeof setInterval> | null;
	timeoutId: ReturnType<typeof setTimeout> | null;
}

function makeTimer(): TimerState {
	return { intervalId: null, timeoutId: null };
}

function startTimerState(state: TimerState, intervalMs: number, callback: () => void, initialDelayMs: number): void {
	stopTimerState(state);
	if (intervalMs <= 0) return;

	const runAndReschedule = (): void => {
		state.intervalId = setInterval(callback, intervalMs);
		callback();
	};

	if (initialDelayMs <= 0) {
		runAndReschedule();
		return;
	}

	state.timeoutId = setTimeout(() => {
		state.timeoutId = null;
		runAndReschedule();
	}, initialDelayMs);
}

function stopTimerState(state: TimerState): void {
	if (state.timeoutId !== null) {
		clearTimeout(state.timeoutId);
		state.timeoutId = null;
	}
	if (state.intervalId !== null) {
		clearInterval(state.intervalId);
		state.intervalId = null;
	}
}

function isTimerRunning(state: TimerState): boolean {
	return state.timeoutId !== null || state.intervalId !== null;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ExtensionManagerController {
	private readonly pi: ExtensionAPI;
	private readonly timer: TimerState = makeTimer();

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	// -------------------------------------------------------------------------
	// Session lifecycle
	// -------------------------------------------------------------------------

	async bootstrap(
		ctx: ExtensionCommandContext | ExtensionContext,
		onUpdateAvailable?: (pkgs: string[]) => void,
	): Promise<void> {
		await hydrateAutoUpdateConfig(this.pi, ctx);

		if (!ctx.hasUI) {
			this.stopAutoUpdate();
			return;
		}

		const config = getAutoUpdateConfig(ctx);
		if (config.enabled && config.intervalMs > 0) {
			this.startAutoUpdate(ctx, config, onUpdateAvailable);
		} else {
			this.stopAutoUpdate();
		}

		setImmediate(() => {
			this.refreshStatus(ctx).catch((err: unknown) => {
				console.error("[extmgr] Status update failed:", err);
			});
		});
	}

	shutdown(): void {
		this.stopAutoUpdate();
	}

	// -------------------------------------------------------------------------
	// Config access
	// -------------------------------------------------------------------------

	getConfig(ctx: ExtensionCommandContext | ExtensionContext): AutoUpdateConfig {
		return getAutoUpdateConfig(ctx);
	}

	async getConfigAsync(ctx: ExtensionCommandContext | ExtensionContext): Promise<AutoUpdateConfig> {
		return getAutoUpdateConfigAsync(ctx);
	}

	saveConfig(config: Partial<AutoUpdateConfig>): void {
		saveAutoUpdateConfig(this.pi, config);
	}

	clearUpdates(ctx: ExtensionCommandContext | ExtensionContext, identities?: Iterable<string>): void {
		clearUpdatesAvailable(this.pi, ctx, identities);
	}

	// -------------------------------------------------------------------------
	// Auto-update
	// -------------------------------------------------------------------------

	isAutoUpdateRunning(): boolean {
		return isTimerRunning(this.timer);
	}

	startAutoUpdate(
		ctx: ExtensionCommandContext | ExtensionContext,
		config: AutoUpdateConfig,
		onUpdateAvailable?: (pkgs: string[]) => void,
	): void {
		const interval = getScheduleInterval(config);
		if (!interval) return;

		const now = Date.now();
		const initialDelayMs =
			typeof config.nextCheck === "number" && config.nextCheck > now ? Math.max(0, config.nextCheck - now) : 0;

		startTimerState(
			this.timer,
			interval,
			() => {
				this.checkForUpdates(ctx, onUpdateAvailable).catch((err: unknown) => {
					console.warn("[extmgr] Auto-update check failed:", err);
				});
			},
			initialDelayMs,
		);
	}

	stopAutoUpdate(): void {
		stopTimerState(this.timer);
	}

	async checkForUpdates(
		ctx: ExtensionCommandContext | ExtensionContext,
		onUpdateAvailable?: (pkgs: string[]) => void,
	): Promise<string[]> {
		const updates = await getPackageCatalog(ctx.cwd).checkForAvailableUpdates();
		const updatesAvailable = updates.map((u) => normalizePackageIdentity(u.source));
		const displayNames = updates.map((u) => u.displayName);

		const config = getAutoUpdateConfig(ctx);
		saveAutoUpdateConfig(this.pi, {
			...config,
			lastCheck: Date.now(),
			nextCheck: calculateNextCheck(config.intervalMs),
			updatesAvailable,
		});

		if (displayNames.length > 0) onUpdateAvailable?.(displayNames);
		return displayNames;
	}

	getKnownUpdates(ctx: ExtensionCommandContext | ExtensionContext): Set<string> {
		return new Set(getAutoUpdateConfig(ctx).updatesAvailable ?? []);
	}

	getAutoUpdateStatusText(ctx: ExtensionCommandContext | ExtensionContext): string {
		const config = getAutoUpdateConfig(ctx);
		if (!config.enabled || config.intervalMs === 0) return "auto-update off";
		const indicator = this.isAutoUpdateRunning() ? ">" : "||";
		return `${indicator} ${config.displayText}`;
	}

	async enableAutoUpdate(
		ctx: ExtensionCommandContext | ExtensionContext,
		intervalMs: number,
		displayText: string,
		onUpdateAvailable?: (pkgs: string[]) => void,
	): Promise<void> {
		const config: AutoUpdateConfig = {
			intervalMs,
			enabled: true,
			displayText,
			nextCheck: calculateNextCheck(intervalMs),
			updatesAvailable: [],
		};
		saveAutoUpdateConfig(this.pi, config);
		logAutoUpdateConfig(this.pi, `set to ${displayText}`, true);
		this.startAutoUpdate(ctx, config, onUpdateAvailable);
		notify(ctx, `Auto-update enabled: ${displayText}`, "info");
	}

	disableAutoUpdate(ctx: ExtensionCommandContext | ExtensionContext): void {
		this.stopAutoUpdate();
		saveAutoUpdateConfig(this.pi, { intervalMs: 0, enabled: false, displayText: "off", updatesAvailable: [] });
		logAutoUpdateConfig(this.pi, "disabled", true);
		notify(ctx, "Auto-update disabled", "info");
	}

	async promptAutoUpdateWizard(
		ctx: ExtensionCommandContext | ExtensionContext,
		onUpdateAvailable?: (pkgs: string[]) => void,
	): Promise<void> {
		if (!ctx.hasUI) {
			notify(ctx, "Auto-update wizard requires interactive mode.", "warning");
			return;
		}

		const current = getAutoUpdateConfig(ctx);
		const choice = await ctx.ui.select(`Auto-update (${current.displayText})`, [
			"Off",
			"Every hour",
			"Daily",
			"Weekly",
			"Custom...",
			"Cancel",
		]);

		if (!choice || choice === "Cancel") return;

		if (choice === "Off") {
			this.disableAutoUpdate(ctx);
			return;
		}
		if (choice === "Every hour") {
			await this.enableAutoUpdate(ctx, 60 * 60 * 1000, "1 hour", onUpdateAvailable);
			return;
		}
		if (choice === "Daily") {
			await this.enableAutoUpdate(ctx, 24 * 60 * 60 * 1000, "daily", onUpdateAvailable);
			return;
		}
		if (choice === "Weekly") {
			await this.enableAutoUpdate(ctx, 7 * 24 * 60 * 60 * 1000, "weekly", onUpdateAvailable);
			return;
		}

		const input = await ctx.ui.input("Auto-update interval", current.displayText || "1d");
		if (!input?.trim()) return;

		const parsed = parseDuration(input.trim());
		if (!parsed) {
			notify(ctx, "Invalid duration. Examples: 1h, 1d, 1w, 1m, never", "warning");
			return;
		}

		if (parsed.ms === 0) {
			this.disableAutoUpdate(ctx);
		} else {
			await this.enableAutoUpdate(ctx, parsed.ms, parsed.display, onUpdateAvailable);
		}
	}

	// -------------------------------------------------------------------------
	// Status bar
	// -------------------------------------------------------------------------

	async refreshStatus(ctx: ExtensionCommandContext | ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;

		try {
			const [packages, autoUpdateConfig] = await Promise.all([
				getPackageCatalog(ctx.cwd).listInstalledPackages(),
				this.getConfigAsync(ctx),
			]);

			const parts: string[] = [];
			if (packages.length > 0) {
				parts.push(`${packages.length} pkg${packages.length === 1 ? "" : "s"}`);
			}

			const statusText = this.getAutoUpdateStatusText(ctx);
			if (statusText) parts.push(statusText);

			// Prune stale update entries
			const installedIdentities = new Set(
				packages.map((pkg) =>
					normalizePackageIdentity(pkg.source, pkg.resolvedPath ? { resolvedPath: pkg.resolvedPath } : undefined),
				),
			);
			const knownUpdates = autoUpdateConfig.updatesAvailable ?? [];
			const validUpdates = knownUpdates.filter((id) => installedIdentities.has(id));
			if (validUpdates.length !== knownUpdates.length) {
				saveAutoUpdateConfig(this.pi, { ...autoUpdateConfig, updatesAvailable: validUpdates });
			}

			if (validUpdates.length > 0) {
				parts.push(`${validUpdates.length} update${validUpdates.length === 1 ? "" : "s"}`);
			}

			if (parts.length > 0) {
				ctx.ui.setStatus("extmgr", ctx.ui.theme.fg("dim", parts.join(" · ")));
			} else {
				ctx.ui.setStatus("extmgr", undefined);
			}
		} catch {
			// best effort
		}
	}
}
