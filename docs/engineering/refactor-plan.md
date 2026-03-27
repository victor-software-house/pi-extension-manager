# Refactor Plan: pi-extension-manager

Current state: 8,168 lines across 39 files, forked from `ayagmar/pi-extmgr`.
Reference: `pi-skills-manager` (551 lines, single file, same archetype).

---

## Architecture decisions

### Archetype: Operator control-surface (Archetype 3)

Primary: `/ext` slash command for managing local extensions and packages.
Secondary: background auto-update timer, status bar (lightweight Archetype 1).

### Command: `/ext`

Short, memorable, low collision risk. `/extensions` is too generic.

### Command family (RTK pattern)

| Command | Purpose |
|---|---|
| `/ext` | Open interactive manager (custom TUI with search/filter) |
| `/ext show` | Summarize: count local extensions, installed packages, update status |
| `/ext list` | List local extensions (non-interactive safe) |
| `/ext installed` | List installed packages (non-interactive safe) |
| `/ext install <source>` | Install a package |
| `/ext remove <source>` | Remove a package |
| `/ext update [source]` | Update one or all packages |
| `/ext remote` | Browse/search npm packages (interactive only) |
| `/ext auto-update <duration>` | Configure auto-update schedule |
| `/ext history [filters]` | Show change history |
| `/ext verify` | Check runtime deps (npm available, paths writable) |
| `/ext path` | Show config and data paths |
| `/ext reset` | Reset settings to defaults |
| `/ext help` | Compact usage line |

### TUI approach: custom component (not SettingsList)

Following `pi-skills-manager`, the main panel uses a custom `ctx.ui.custom()` component:

- `Input` from `@mariozechner/pi-tui` for search/filter
- Scoped search: plain text matches names, `/prefix` matches paths, `@prefix` matches package sources
- Grouped flat list with non-selectable group headers (local extensions, packages by scope)
- View modes cycled with Tab: `by-source | A-Z | active-first`
- Checkbox-style toggles for local extensions: `[x]`/`[ ]` with `theme.fg("success")`/`theme.fg("dim")`
- Package items show `theme.fg("accent", "...")` diamond icon and version
- `DynamicBorder` framing, `rawKeyHint()` for keyboard hints in header
- `truncateToWidth()` and `visibleWidth()` from pi-tui for terminal-safe rendering

Keep the existing theming vocabulary from `ui/theme.ts` (status icons, scope indicators, package icons) — just use them inside the new component.

---

## File inventory — what to keep, rewrite, or delete

### Keep as-is (utility/infra, working correctly)

| File | Lines | Notes |
|---|---|---|
| `utils/network.ts` | 23 | `fetchWithTimeout` — clean |
| `utils/retry.ts` | 49 | Generic retry — clean |
| `utils/npm-exec.ts` | 49 | npm CLI resolution — clean |
| `utils/fs.ts` | 70 | `fileExists`, `readSummary` — clean |
| `utils/notify.ts` | 50 | Notification abstraction — clean |
| `utils/command.ts` | 98 | Tokenizer — clean |
| `utils/package-source.ts` | 153 | Source parsing — clean, well-tested |
| `packages/catalog.ts` | 162 | `PackageCatalog` abstraction — clean |
| `ui/async-task.ts` | 158 | Loader component — clean |

### Keep with minor edits

| File | Lines | Changes |
|---|---|---|
| `ui/theme.ts` | 87 | Keep all icons/formatters. No emojis present here. |
| `constants.ts` | 77 | Keep timeouts/limits. Remove `UI` constants if unused after panel rewrite. |
| `types/index.ts` | 96 | Trim: remove `UnifiedAction`, `BrowseAction` (UI-specific). Keep core types. |
| `utils/format.ts` | 166 | Keep source parsing. Remove `dynamicTruncate` (use `truncateToWidth` from pi-tui). |
| `utils/mode.ts` | 88 | Keep `getUICapability`, `hasCustomUI`, `requireCustomUI`. Remove `runCustomUI` wrapper (inline at call sites). |
| `commands/install.ts` | 83 | Update command name in usage string. |
| `commands/auto-update.ts` | 80 | Update command name. |

### Rewrite substantially

| File | Lines | Target | Reason |
|---|---|---|---|
| `index.ts` | 104 | ~120 | Add `session_tree`, `session_fork`. Create controller. Wire new command name. |
| `commands/registry.ts` | 206 | ~120 | Simplify: add RTK subcommands (`show`, `verify`, `path`, `reset`). Remove `local` default indirection. |
| `commands/types.ts` | 30 | ~20 | Add new CommandId values. |
| `utils/settings.ts` | 380 | ~150 | Zod schema for `AutoUpdateConfig`. Remove manual sanitizers. Keep disk persistence. |
| `utils/auto-update.ts` | 244 | ~100 | Move timer state into controller. Simplify. |
| `utils/timer.ts` | 60 | ~40 | Accept state from caller instead of module globals. |
| `utils/cache.ts` | 427 | ~200 | Zod for cache data. Remove duplicated `isRecord`. Keep disk cache. |
| `utils/history.ts` | 387 | ~100 | Drop raw JSONL file walking. Scope to current session via `pi.appendEntry`/`getBranch`. |
| `commands/history.ts` | 266 | ~80 | Simplify to match reduced history scope. |
| `utils/status.ts` | 77 | ~60 | Wire through controller instead of standalone. |
| `extensions/discovery.ts` | 294 | ~200 | Keep logic, clean up types. |
| `packages/discovery.ts` | 397 | ~250 | Move module-level search cache into controller. Keep npm registry search. |
| `packages/management.ts` | 468 | ~300 | Keep update/remove logic. Simplify progress reporting. |
| `packages/install.ts` | 540 | ~400 | Keep install logic. Clean up standalone install path. |
| `packages/extensions.ts` | 655 | ~450 | Keep settings toggle logic. Clean up. |

### Delete and replace

| File | Lines | Replacement |
|---|---|---|
| `ui/unified.ts` | 935 | New `ui/manager-panel.ts` (~300 lines) — custom TUI following pi-skills-manager pattern |
| `ui/remote.ts` | 552 | New `ui/remote-panel.ts` (~250 lines) — extract cache into controller |
| `ui/footer.ts` | 67 | Inline into `manager-panel.ts` header hints |
| `ui/help.ts` | 58 | Inline into `commands/registry.ts` help subcommand |
| `ui/package-config.ts` | 416 | New `ui/package-config-panel.ts` (~200 lines) — same logic, uses pi-tui utilities |
| `utils/settings-list.ts` | 12 | Delete (helper for old SettingsList usage) |

---

## Phase 1: Package metadata and scaffolding

**Risk:** Low. No behavior changes.

1. Update `package.json`: name, repository URL, author, remove `demo` branch ref
2. Remove emojis from `ui/remote.ts` menu constants
3. Update help text and usage strings for `/ext` command name
4. Update `README.md`
5. Set up biome + strict tsconfig matching pi-skills-manager
6. Add `zod` and `@tool-belt/type-predicates` as devDependencies

---

## Phase 2: Controller and state management

**Risk:** High — breaks existing wiring.

1. Create `src/controller.ts` — `ExtensionManagerController`:
   - Owns: auto-update config, timer state, known updates, in-memory caches
   - Methods: `getConfig()`, `setConfig()`, `getConfigPath()`, `getRuntimeStatus()`, `refreshRuntimeStatus()`, `resetCaches()`
   - Config persistence delegates to refactored `utils/settings.ts`

2. Refactor `utils/settings.ts`:
   - Zod schema for `AutoUpdateConfig`
   - `loadConfigFromDisk()`, `saveConfigToDisk()` — pure functions
   - Remove module-level `settingsWriteQueue` (controller manages write serialization)

3. Refactor `utils/timer.ts`:
   - Export `startTimer(state, ...)` / `stopTimer(state)` taking a `TimerState` object
   - No module globals

4. Refactor `index.ts`:
   - Create controller on load
   - Add `session_tree`, `session_fork` handlers calling `bootstrapSession()`
   - `bootstrapSession()` calls `controller.resetCaches()` then restores config

5. Move module-level caches from `packages/discovery.ts` and `ui/remote.ts` into controller

---

## Phase 3: Interactive manager panel

**Risk:** High — replaces main UI.

Build `src/ui/manager-panel.ts` following `pi-skills-manager` pattern:

1. **Data model:** `FlatEntry = { type: "group"; ... } | { type: "item"; item: ExtItem | PkgItem }`
2. **Groups:** "Local (global)", "Local (project)", per-package-source groups
3. **Search/filter:** `Input` component, scoped search (`/path`, `@package`, plain text for names)
4. **View modes:** Tab cycles `by-source | A-Z | active-first`
5. **Keyboard:**
   - Space/Enter: toggle local extension enabled/disabled
   - `a`: package actions submenu (update, remove, details, configure)
   - `i`: quick install prompt
   - `u`: update all packages
   - `r`: open remote browse
   - `?`: help
   - Esc: close (prompt to reload if changes pending)
6. **Rendering:**
   - Header: `theme.bold("Extension Manager")` + `rawKeyHint()` shortcuts + separator
   - Filter hint: `theme.fg("muted", "Filter: name . /path . @source")`
   - Groups: `theme.fg("accent", theme.bold(groupLabel))`
   - Local items: cursor `> ` + `getStatusIcon()` + `getScopeIcon()` + name + summary
   - Package items: cursor `> ` + `getPackageIcon()` + `getScopeIcon()` + name@version + description
   - Update indicator: `theme.fg("warning", " [update]")`
   - Position counter + view mode label in footer
   - `DynamicBorder` top and bottom
7. **After close:** if `changeCount > 0`, prompt `ctx.ui.confirm()` then `ctx.reload(); return;`

Delete `ui/unified.ts`, `ui/footer.ts`, `ui/help.ts`, `utils/settings-list.ts`.

---

## Phase 4: Remote browsing cleanup

**Risk:** Medium.

1. Extract npm registry client logic from `ui/remote.ts` into `packages/discovery.ts` (already partially there)
2. New `ui/remote-panel.ts` (~250 lines):
   - Same SelectList-based browse/search/details flow
   - Remove emoji menu labels, use text: `[search] Search packages`, `[install] Install by source`, `[browse] Browse pi packages`
   - Package info cache managed by controller
3. Clean up `ui/package-config.ts` -> `ui/package-config-panel.ts`:
   - Same SettingsList-based flow (appropriate here — flat items, no groups)
   - Use pi-tui `truncateToWidth` instead of custom `dynamicTruncate`

---

## Phase 5: History and type safety

**Risk:** Low.

1. **History:** Drop raw JSONL file walking from `utils/history.ts`. Keep `pi.appendEntry()` for logging and `ctx.sessionManager.getBranch()` for current-session queries. Remove `queryGlobalHistory()` entirely. Simplify `commands/history.ts`.

2. **Type safety:**
   - Zod schemas for: `AutoUpdateConfig`, `CacheData`, `ChangeRecord`, npm API responses
   - Replace `typeof x === 'string'` with `isString(x)` from `@tool-belt/type-predicates`
   - Remove all duplicated `isRecord()` helpers (use Zod or `isObject()`)

---

## Execution order

| Step | Phase | Size |
|---|---|---|
| 1 | Phase 1: Package metadata + scaffolding | Small |
| 2 | Phase 2: Controller + state management | Large |
| 3 | Phase 3: Interactive manager panel | Large |
| 4 | Phase 4: Remote browsing cleanup | Medium |
| 5 | Phase 5: History + type safety | Small |

Phases 2 and 3 are the core. Everything else is cleanup.

---

## Target metrics

| Metric | Current | Target |
|---|---|---|
| Files | 39 | ~25 |
| Total lines | 8,168 | ~4,000 |
| Largest file | 935 (unified.ts) | ~400 (install.ts, kept) |
| Module-level singletons | 6 | 0 |
| Lifecycle events handled | 3 | 5 (add session_tree, session_fork) |
| Search/filter in main panel | No | Yes (Input + scoped search) |
| View modes | No | 3 (by-source, A-Z, active-first) |

---

## Validation checklist

- [ ] Clear archetype: operator control-surface
- [ ] RTK command family with `show`, `verify`, `path`, `reset`, `help`
- [ ] Custom TUI with `Input` search/filter (pi-skills-manager pattern)
- [ ] Scoped search: plain text, `/path`, `@source`
- [ ] View modes: Tab cycles by-source / A-Z / active-first
- [ ] Existing theme vocabulary preserved (status icons, scope icons, package icons)
- [ ] `DynamicBorder`, `rawKeyHint()`, `truncateToWidth()`, `visibleWidth()` from pi-tui
- [ ] Controller pattern: config + runtime status separated
- [ ] Zod validation on load and save
- [ ] `session_start`, `session_tree`, `session_fork`, `session_switch`, `session_shutdown` all handled
- [ ] No module-level mutable singletons
- [ ] Mode-aware: non-interactive fallbacks for all commands
- [ ] No emojis
- [ ] No raw session file access
- [ ] Reload-safe: return after `ctx.reload()`, no stale refs
- [ ] After changes, prompt reload (pi-skills-manager pattern)
