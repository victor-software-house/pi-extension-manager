# Refactor Plan: pi-extension-manager

Current state: 8,168 lines across 31 files, forked from `ayagmar/pi-extmgr`.
Target: rewrite to align with Pi extension best practices, fix architectural issues.

---

## Architecture decisions

### Archetype: Operator control-surface (Archetype 3)

Primary purpose is a `/extensions` slash command for managing local extensions and packages.
Secondary: background auto-update timer (lightweight Archetype 1 behavior).

### Command name: `/ext`

Short, memorable, low collision risk. `/extensions` is too generic and likely to collide with a future Pi built-in.

### Command family structure (RTK pattern)

| Command | Purpose |
|---|---|
| `/ext` | Open interactive manager (SettingsList with search) |
| `/ext show` | Summarize: count local extensions, installed packages, update status |
| `/ext list` | List local extensions (works in non-interactive mode) |
| `/ext installed` | List installed packages |
| `/ext install <source>` | Install a package |
| `/ext remove <source>` | Remove a package |
| `/ext update [source]` | Update one or all packages |
| `/ext remote` | Browse/search npm packages (interactive only) |
| `/ext auto-update <duration>` | Configure auto-update schedule |
| `/ext history [filters]` | Show change history |
| `/ext verify` | Check runtime dependencies (npm available, paths writable) |
| `/ext path` | Show config and data paths |
| `/ext reset` | Reset settings to defaults |
| `/ext help` | Compact usage line |

---

## Phase 1: State management and lifecycle

**Problem:** Module-level singletons (`timer.ts`, `PackageInfoCache`, `settingsWriteQueue`), no `session_tree`/`session_fork` handling, no reload safety.

### Changes

1. **Create `ExtensionManagerController`** following the config-and-controller pattern:
   - Owns all mutable state (auto-update config, known updates, caches)
   - Single instance created in `index.ts`, passed by reference
   - `getConfig()`, `setConfig()`, `getConfigPath()`, `getRuntimeStatus()`, `refreshRuntimeStatus()`
   - Config normalization on both load and save (Zod schema)

2. **Add missing lifecycle handlers:**
   ```
   session_start    -> bootstrapSession (existing, refactored)
   session_tree     -> bootstrapSession (new)
   session_fork     -> bootstrapSession (new)
   session_switch   -> bootstrapSession (existing)
   session_shutdown -> stopTimer (existing)
   ```
   All handlers call the same `bootstrapSession()` which:
   - Stops any running timer
   - Rehydrates config from disk
   - Clears in-memory caches
   - Restarts timer if applicable
   - Updates status bar

3. **Eliminate module-level singletons:**
   - `timer.ts` state moves into controller
   - `PackageInfoCache` in `remote.ts` moves into controller
   - `settingsWriteQueue` in `settings.ts` moves into controller
   - Search cache in `discovery.ts` moves into controller

4. **Config validation with Zod:**
   - Replace hand-rolled `isRecord()` / `typeof` checks in `settings.ts` with a Zod schema
   - Single `AutoUpdateConfigSchema` validates on load and save
   - Remove duplicated `isRecord()` from `settings.ts` and `history.ts`

### Files affected
- `src/index.ts` — add `session_tree`, `session_fork`, create controller
- `src/controller.ts` — new, owns state
- `src/config.ts` — new, Zod schemas, normalize/load/save
- `src/utils/timer.ts` — remove module globals, accept state from caller
- `src/utils/settings.ts` — gut and redirect to controller
- `src/ui/remote.ts` — remove module-level cache
- `src/packages/discovery.ts` — remove module-level search cache

---

## Phase 2: Interactive manager with SettingsList search

**Problem:** The main `/ext` view is a 917-line monolith (`unified.ts`) that builds its own bespoke list UI without using `SettingsList`'s built-in `enableSearch` option. Users cannot type to filter.

### Changes

1. **Rebuild the main interactive view using `SettingsList` with `{ enableSearch: true }`:**
   - Each local extension and installed package becomes a `SettingItem`
   - Local extensions: `values: ["enabled", "disabled"]`, toggling via Enter/Space
   - Packages: submenu with actions (update, remove, details, configure)
   - Type-to-filter works out of the box via `enableSearch`

2. **Split `unified.ts` into focused modules:**
   - `src/ui/manager-panel.ts` — main interactive panel (~150 lines)
   - `src/ui/item-builder.ts` — builds `SettingItem[]` from extensions + packages
   - `src/ui/actions.ts` — handles toggle apply, package actions, navigation
   - Delete `unified.ts`

3. **Apply toggle changes on panel close** (existing behavior, preserve):
   - Track pending toggles
   - On Esc/close, if pending changes exist, prompt to apply + reload

4. **Footer shortcuts** integrated into the panel:
   - `i` install, `u` update all, `r` remote browse, `?` help
   - Shown via hint line in SettingsList or a footer Text component

### Pattern reference (from `tools.ts` official example)
```typescript
const settingsList = new SettingsList(
  items,
  Math.min(items.length + 2, 15),
  getSettingsListTheme(),
  (id, newValue) => { /* toggle immediately */ },
  () => done(undefined),
  { enableSearch: true },
);
```

### Files affected
- `src/ui/unified.ts` — delete (917 lines)
- `src/ui/manager-panel.ts` — new (~150 lines)
- `src/ui/item-builder.ts` — new (~100 lines)
- `src/ui/actions.ts` — new (~150 lines)
- `src/ui/footer.ts` — simplify or remove

---

## Phase 3: Remote browsing cleanup

**Problem:** `remote.ts` (542 lines) mixes caching, npm CLI execution, UI rendering, and package details in one file.

### Changes

1. **Extract npm registry client:**
   - `src/registry/npm-client.ts` — search, view, downloads
   - Cache managed by controller, not module-level
   - Timeout and abort signal handling stays here

2. **Simplify remote UI:**
   - `src/ui/remote-panel.ts` — browse/search/details using `SelectList`
   - Remove emoji constants (`REMOTE_MENU_CHOICES`)
   - Use text labels: `[search]`, `[install]`, `[browse]`

3. **Remove `npm-exec.ts`** if `execNpm` calls can route through the registry client

### Files affected
- `src/ui/remote.ts` — delete (542 lines)
- `src/registry/npm-client.ts` — new
- `src/ui/remote-panel.ts` — new (~200 lines)
- `src/utils/npm-exec.ts` — keep or merge into registry client

---

## Phase 4: History cleanup

**Problem:** `history.ts` (384 lines) reads raw JSONL session files from `~/.pi/agent/sessions/`, coupling to Pi's internal storage format.

### Changes

1. **Session-local history:** keep `pi.appendEntry()` / `ctx.sessionManager.getBranch()` for current session queries (official API)
2. **Global history:** remove raw JSONL file walking entirely. Scope history to current session only. If cross-session history is needed later, wait for Pi to expose an official API.
3. **Simplify history types:** single `ChangeRecord` type validated with Zod

### Files affected
- `src/utils/history.ts` — rewrite, drop to ~100 lines
- `src/commands/history.ts` — simplify

---

## Phase 5: Type safety

**Problem:** Manual `typeof` checks, duplicated `isRecord()`, no Zod, no `@tool-belt/type-predicates`.

### Changes

1. **Add dependencies:** `zod`, `@tool-belt/type-predicates`
2. **Zod schemas for:**
   - `AutoUpdateConfig` (replaces manual sanitization in `settings.ts`)
   - `ChangeRecord` (replaces `isExtensionChangeEntry` guard in `history.ts`)
   - npm view response (replaces `NpmViewInfo` interface with runtime validation)
3. **Replace all `typeof x === 'string'`** with `isString(x)` from `@tool-belt/type-predicates`
4. **Remove all duplicated `isRecord()`** helpers

### Files affected
- `src/config.ts` — Zod schemas
- `src/utils/settings.ts` — remove manual validation
- `src/utils/history.ts` — remove manual guards
- `src/ui/remote.ts` → `src/registry/npm-client.ts` — Zod for API responses
- `package.json` — add `zod`, `@tool-belt/type-predicates`

---

## Phase 6: Package metadata and naming

### Changes

1. **Rename package** to `pi-extension-manager` in `package.json`
2. **Update `pi.extensions`** entry point path
3. **Update `repository` URL** to `victor-software-house/pi-extension-manager`
4. **Remove all emojis** from UI constants and menu labels
5. **Update README** for new command name and structure

---

## Execution order

| Order | Phase | Risk | Estimated size |
|---|---|---|---|
| 1 | Phase 6: Package metadata | Low | Small |
| 2 | Phase 5: Type safety (add deps, schemas) | Low | Medium |
| 3 | Phase 1: State + lifecycle | High | Large — breaks existing wiring |
| 4 | Phase 2: Interactive manager with search | High | Large — replaces main UI |
| 5 | Phase 3: Remote browsing | Medium | Medium |
| 6 | Phase 4: History | Low | Small |

Phase 1 and 2 are the core of the rewrite. Everything else is cleanup.

---

## File count target

| Current | Target |
|---|---|
| 31 files, 8,168 lines | ~20 files, ~3,000 lines |

Major deletions: `unified.ts` (917), `remote.ts` (542), `settings.ts` (375), `history.ts` (384) — ~2,200 lines removed and replaced with ~800 lines of focused code.

---

## Validation checklist (from Pi skill)

- [ ] Clear archetype: operator control-surface
- [ ] RTK command family with `show`, `verify`, `path`, `reset`, `help`
- [ ] `SettingsList` with `enableSearch: true` for type-to-filter
- [ ] Controller pattern: config + runtime status separated
- [ ] Zod validation on load and save
- [ ] `session_start`, `session_tree`, `session_fork`, `session_switch`, `session_shutdown` all handled
- [ ] No module-level mutable singletons
- [ ] Mode-aware: non-interactive fallbacks for all commands
- [ ] No emojis
- [ ] No raw session file access
- [ ] Reload-safe: return after `ctx.reload()`, no stale refs
