# pi-extension-manager

Interactive extension and package manager for Pi. Provides `/extensions` with subcommands.

Safe-push repo. Push to `main` freely — CI runs lint + typecheck before tag-driven private GitHub Packages release.

## Orient

Source in `src/`, no build step — jiti loads TypeScript directly at runtime.

```
src/
├── index.ts            # Extension entry point: registers /extensions, wires lifecycle events
├── controller.ts       # Central runtime object: owns auto-update config, timer, status, catalog
├── constants.ts        # Timeouts, cache limits, data dir path
├── types/
│   └── index.ts        # Shared type definitions
├── commands/           # Subcommand handlers (install, show, history, verify, auto-update, …)
│   └── registry.ts     # Command routing, autocomplete, help
├── extensions/         # Local extension discovery
├── packages/           # npm package operations (install, remove, update, catalog, search)
├── ui/                 # TUI panels (manager, remote browse, async-task loader, theme)
└── utils/              # Pure helpers (cache, format, fs, network, retry, settings, history, …)
```

Key files for understanding the architecture:
- `src/index.ts` — full extension entry point; short, read it first
- `src/controller.ts` — `ExtensionManagerController`: all mutable runtime state lives here
- `src/commands/registry.ts` — command routing and RTK subcommand table
- `docs/engineering/refactor-plan.md` — architecture decisions and file-level inventory

## Command surface

See [README.md](README.md) for full command table. Do not duplicate it here.

Core pattern: `/extensions [subcommand] [args]`. Bare `/extensions` opens interactive TUI.
Non-interactive mode (print/RPC/JSON) gets plain-text output — never assume `ctx.hasUI` is true.

## Verification

Lefthook pre-commit runs both automatically. Run them manually when iterating:

```bash
pnpm run typecheck   # tsc --noEmit (strict: noUncheckedIndexedAccess, exactOptionalPropertyTypes)
pnpm run lint        # biome check . (no any, no non-null assertions)
pnpm run test        # vitest run --passWithNoTests
pnpm run build       # tsc
```

No test files yet. Verify TUI changes by installing locally into a Pi session:

```bash
pi install path:.    # from repo root, in a Pi session
/extensions          # exercise change
```

After verifying, push `main` for CI; create a `v*.*.*` tag to trigger private GitHub Packages release.

## Coding rules

- Tabs, double quotes, semicolons (biome)
- `node:` protocol for all Node.js imports
- Peer dependencies only for Pi core packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`)
- No `any`, no non-null assertions (`!`), no unsafe type assertions (`as`)
- Prefer `const` — biome enforces this

## Architecture constraints

### Controller pattern

`ExtensionManagerController` (created once in `index.ts`) owns all mutable state: auto-update config, background timer, package status cache. Pass it down — do not create module-level singletons or global state.

### Lifecycle events

The extension handles: `session_start`, `session_switch`, `session_tree`, `session_fork`, `session_shutdown`.
All session-entry events call `controller.bootstrap()`. Shutdown calls `controller.shutdown()`.

### Reload semantics

After install/remove/update/toggle operations, prompt user to reload. Pattern:

```ts
ctx.reload();
return; // terminal — no code after reload
```

DO: treat `ctx.reload()` as return point. DO NOT: execute logic after calling it.

### State persistence

- Auto-update config: `~/.pi/agent/.extmgr-cache/auto-update.json`
- Package metadata cache: `~/.pi/agent/.extmgr-cache/metadata.json`
- Data dir override: `PI_EXTMGR_CACHE_DIR` env var (see `constants.ts`)

### Mode awareness

Always check `ctx.hasUI` before rendering TUI components. Non-interactive paths must produce plain text via `ctx.print()`.

## Release

- Tag-driven private GitHub Packages release on `v*.*.*`
- Release workflow verifies tag ↔ package version, runs lint + typecheck + test + build, then publishes with `pnpm publish --access restricted --no-git-checks`
- Conventional commits still used for normal history

## Safety rules

- DO NOT delete or modify files under `~/.pi/agent/` outside the `.extmgr-cache/` directory
- DO NOT run dependency install/update commands outside the controlled `src/packages/install.ts` flow
- Ask before adding new peer dependencies — they affect every Pi installation that uses this package
