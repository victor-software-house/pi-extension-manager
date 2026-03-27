/**
 * Core types and interfaces for pi-extmgr
 */

export type Scope = "global" | "project";
export type State = "enabled" | "disabled";

export interface ExtensionEntry {
	id: string;
	scope: Scope;
	state: State;
	activePath: string;
	disabledPath: string;
	displayName: string;
	summary: string;
}

export interface NpmPackage {
	name: string;
	version?: string | undefined;
	description?: string | undefined;
	keywords?: string[] | undefined;
	date?: string | undefined;
	size?: number | undefined; // Package size in bytes
}

export interface InstalledPackage {
	source: string;
	name: string;
	version?: string | undefined;
	scope: "global" | "project";
	resolvedPath?: string | undefined;
	description?: string | undefined;
	size?: number | undefined; // Package size in bytes
}

export interface PackageExtensionEntry {
	id: string;
	packageSource: string;
	packageName: string;
	packageScope: Scope;
	extensionPath: string;
	absolutePath: string;
	displayName: string;
	summary: string;
	state: State;
}

export interface UnifiedItem {
	type: "local" | "package";
	id: string;
	displayName: string;
	summary: string;
	scope: Scope;
	// Local extension fields
	state?: State | undefined;
	activePath?: string | undefined;
	disabledPath?: string | undefined;
	originalState?: State | undefined;
	// Package fields
	source?: string | undefined;
	version?: string | undefined;
	description?: string | undefined;
	size?: number | undefined; // Package size in bytes
	updateAvailable?: boolean | undefined;
}

export interface SearchCache {
	query: string;
	results: NpmPackage[];
	timestamp: number;
}

// Action types for unified view
