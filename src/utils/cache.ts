/**
 * Persistent cache for package metadata to reduce npm API calls
 */
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CACHE_LIMITS, DATA_DIR } from "../constants.js";
import type { InstalledPackage, NpmPackage } from "../types/index.js";
import { parseNpmSource } from "./format.js";

const CACHE_DIR = DATA_DIR;
const CACHE_FILE = join(CACHE_DIR, "metadata.json");
const CURRENT_SEARCH_CACHE_STRATEGY = "npm-registry-v1-paginated";

interface CachedPackageData {
	name: string;
	description?: string | undefined;
	version?: string | undefined;
	size?: number | undefined;
	timestamp: number;
}

interface CacheData {
	version: number;
	packages: Map<string, CachedPackageData>;
	lastSearch?:
		| {
				query: string;
				results: string[];
				timestamp: number;
				strategy: string;
		  }
		| undefined;
}

let memoryCache: CacheData | null = null;
let cacheWriteQueue: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Zod schemas for disk deserialization
// ---------------------------------------------------------------------------

const CachedPackageDataSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	version: z.string().optional(),
	size: z.number().nonnegative().optional(),
	timestamp: z.number().positive(),
});

const CacheDiskSchema = z.object({
	version: z.number().default(1),
	packages: z.record(z.string(), z.unknown()).default({}),
	lastSearch: z
		.object({
			query: z.string(),
			timestamp: z.number(),
			results: z.array(z.string()),
			strategy: z.string().min(1),
		})
		.optional(),
});

function normalizeCacheFromDisk(input: unknown): CacheData {
	const parsed = CacheDiskSchema.safeParse(input);
	if (!parsed.success) return { version: 1, packages: new Map() };

	const packages = new Map<string, CachedPackageData>();
	for (const [key, value] of Object.entries(parsed.data.packages)) {
		const entry = CachedPackageDataSchema.safeParse({
			...(value as object),
			name: (value as Record<string, unknown>)?.name ?? key,
		});
		if (entry.success) packages.set(key, entry.data);
	}

	return { version: parsed.data.version, packages, lastSearch: parsed.data.lastSearch };
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
	try {
		await access(CACHE_DIR);
	} catch {
		await mkdir(CACHE_DIR, { recursive: true });
	}
}

async function backupCorruptCacheFile(): Promise<void> {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = join(CACHE_DIR, `metadata.invalid-${stamp}.json`);

	try {
		await rename(CACHE_FILE, backupPath);
		console.warn(`[extmgr] Invalid metadata cache JSON. Backed up to ${backupPath}.`);
	} catch (error) {
		console.warn("[extmgr] Failed to backup invalid cache file:", error);
	}
}

/**
 * Load cache from disk
 */
async function loadCache(): Promise<CacheData> {
	if (memoryCache) return memoryCache;

	try {
		await ensureCacheDir();
		const data = await readFile(CACHE_FILE, "utf8");
		const trimmed = data.trim();

		if (!trimmed) {
			memoryCache = {
				version: 1,
				packages: new Map(),
			};
			return memoryCache;
		}

		try {
			const parsed = JSON.parse(trimmed) as unknown;
			memoryCache = normalizeCacheFromDisk(parsed);
		} catch {
			await backupCorruptCacheFile();
			memoryCache = {
				version: 1,
				packages: new Map(),
			};
		}
	} catch (error) {
		// Cache doesn't exist or is unreadable, start fresh
		if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
			console.warn("[extmgr] Cache load failed, resetting:", error.message);
		}
		memoryCache = {
			version: 1,
			packages: new Map(),
		};
	}

	return memoryCache;
}

/**
 * Save cache to disk
 */
async function saveCache(): Promise<void> {
	if (!memoryCache) return;

	await ensureCacheDir();

	const data: {
		version: number;
		packages: Record<string, CachedPackageData>;
		lastSearch?: { query: string; results: string[]; timestamp: number; strategy: string } | undefined;
	} = {
		version: memoryCache.version,
		packages: Object.fromEntries(memoryCache.packages),
		lastSearch: memoryCache.lastSearch,
	};

	const content = `${JSON.stringify(data, null, 2)}\n`;
	const tmpPath = join(CACHE_DIR, `metadata.${process.pid}.${Date.now()}.tmp`);

	try {
		await writeFile(tmpPath, content, "utf8");
		await rename(tmpPath, CACHE_FILE);
	} catch {
		// Fallback for filesystems where rename-overwrite can fail.
		await writeFile(CACHE_FILE, content, "utf8");
	} finally {
		await rm(tmpPath, { force: true }).catch(() => undefined);
	}
}

async function enqueueCacheSave(): Promise<void> {
	cacheWriteQueue = cacheWriteQueue
		.catch(() => undefined)
		.then(() => saveCache())
		.catch((error) => {
			console.warn("[extmgr] Cache save failed:", error instanceof Error ? error.message : error);
		});

	return cacheWriteQueue;
}

/**
 * Check if cached data is still valid (within TTL)
 */
function isCacheValid(timestamp: number): boolean {
	return Date.now() - timestamp < CACHE_LIMITS.metadataTTL;
}

/**
 * Get cached package data
 */
export async function getCachedPackage(name: string): Promise<CachedPackageData | null> {
	const cache = await loadCache();
	const data = cache.packages.get(name);

	if (!data || !isCacheValid(data.timestamp)) {
		return null;
	}

	return data;
}

/**
 * Set cached package data
 */
export async function setCachedPackage(name: string, data: Omit<CachedPackageData, "timestamp">): Promise<void> {
	const cache = await loadCache();
	cache.packages.set(name, {
		...data,
		timestamp: Date.now(),
	});
	await enqueueCacheSave();
}

/**
 * Get cached search results
 */
export async function getCachedSearch(query: string): Promise<NpmPackage[] | null> {
	const cache = await loadCache();

	if (!cache.lastSearch || cache.lastSearch.query !== query) {
		return null;
	}

	if (Date.now() - cache.lastSearch.timestamp >= CACHE_LIMITS.searchTTL) {
		return null;
	}

	if (cache.lastSearch.strategy !== CURRENT_SEARCH_CACHE_STRATEGY) {
		return null;
	}

	// Reconstruct packages from cached names
	const packages: NpmPackage[] = [];
	for (const name of cache.lastSearch.results) {
		const pkg = cache.packages.get(name);
		if (pkg) {
			packages.push({
				name: pkg.name,
				description: pkg.description ?? undefined,
				version: pkg.version ?? undefined,
			});
		}
	}

	return packages;
}

/**
 * Set cached search results
 */
export async function setCachedSearch(query: string, packages: NpmPackage[]): Promise<void> {
	const cache = await loadCache();

	// Update cache with new packages
	for (const pkg of packages) {
		cache.packages.set(pkg.name, {
			name: pkg.name,
			description: pkg.description ?? undefined,
			version: pkg.version ?? undefined,
			timestamp: Date.now(),
		});
	}

	// Store search results
	cache.lastSearch = {
		query,
		results: packages.map((p) => p.name),
		timestamp: Date.now(),
		strategy: CURRENT_SEARCH_CACHE_STRATEGY,
	};

	await enqueueCacheSave();
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
	memoryCache = {
		version: 1,
		packages: new Map(),
	};
	await enqueueCacheSave();
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
	totalPackages: number;
	validEntries: number;
	expiredEntries: number;
}> {
	const cache = await loadCache();
	let valid = 0;
	let expired = 0;

	for (const [, data] of cache.packages) {
		if (isCacheValid(data.timestamp)) {
			valid++;
		} else {
			expired++;
		}
	}

	return {
		totalPackages: cache.packages.size,
		validEntries: valid,
		expiredEntries: expired,
	};
}

/**
 * Batch get descriptions for installed packages (uses cache first)
 */
export async function getPackageDescriptions(packages: InstalledPackage[]): Promise<Map<string, string>> {
	const descriptions = new Map<string, string>();
	const cache = await loadCache();

	for (const pkg of packages) {
		const npmSource = parseNpmSource(pkg.source);
		if (!npmSource?.name) continue;

		const cached = cache.packages.get(npmSource.name);
		if (cached?.description && isCacheValid(cached.timestamp)) {
			descriptions.set(pkg.source, cached.description);
		}
	}

	return descriptions;
}

/**
 * Get package size from cache
 */
export async function getCachedPackageSize(name: string): Promise<number | undefined> {
	const cache = await loadCache();
	const data = cache.packages.get(name);

	if (data && isCacheValid(data.timestamp)) {
		return data.size;
	}

	return undefined;
}

/**
 * Set package size in cache
 */
export async function setCachedPackageSize(name: string, size: number): Promise<void> {
	const cache = await loadCache();
	const existing = cache.packages.get(name);

	if (existing) {
		existing.size = size;
		existing.timestamp = Date.now();
	} else {
		cache.packages.set(name, {
			name,
			size,
			timestamp: Date.now(),
		});
	}

	await enqueueCacheSave();
}
