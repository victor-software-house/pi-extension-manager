# pi-extension-manager

Interactive extension and package manager for Pi. Provides an `/extensions` command.

## Architecture

**Archetype:** Operator control-surface extension (command + TUI).

Source code in `src/`. No build step — jiti loads TypeScript directly.

### Command family (RTK pattern)

- `/extensions` — open interactive manager (custom TUI with search/filter)
- `/extensions show` — summarize state (counts, update status)
- `/extensions list` — list local extensions (non-interactive safe)
- `/extensions installed` — list installed packages
- `/extensions install <source>` — install a package
- `/extensions remove <source>` — remove a package
- `/extensions update [source]` — update outdated packages (or a specific one)
- `/extensions update --all` — force-update all packages regardless of status
- `/extensions remote` — browse/search npm packages (interactive only)
- `/extensions auto-update <duration>` — configure auto-update schedule
- `/extensions history [filters]` — show change history
- `/extensions verify` — check runtime dependencies
- `/extensions path` — show config and data paths
- `/extensions reset` — reset settings to defaults
- `/extensions help` — compact usage line

### State management

Auto-update config persisted to `~/.pi/agent/.extmgr-cache/auto-update.json`.
Package metadata cached to `~/.pi/agent/.extmgr-cache/metadata.json`.

Lifecycle events handled: `session_start`, `session_switch`, `session_tree`, `session_fork`, `session_shutdown`.

### Mode awareness

- Interactive mode: full TUI with grouped entries, search/filter, keyboard navigation
- Non-interactive (print/RPC/JSON): plain text listing with status indicators

### Reload behavior

After changes, prompts the user to reload. Uses `ctx.reload(); return;` (treat reload as terminal).

## Dev workflow

- Install: `bun install`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Format: `bun run lint:fix`
- Conventional commits enforced via commitlint + lefthook

## Coding guidelines

- Tabs, double quotes, semicolons (biome)
- Strict TS: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- No `any`, no non-null assertions, no unsafe type assertions
- `node:` protocol for Node.js imports
- Peer dependencies only for Pi core packages

## Release

- semantic-release on `main` with npm trusted publishing (OIDC, no npm token)
- `@semantic-release/git` commits version bumps back to git
- Commit prefixes: `fix:` (patch), `feat:` (minor), `feat!:` (major, public API breaks only)
- `chore:`, `docs:`, `refactor:` produce no version bump
