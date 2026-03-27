# pi-extension-manager

Interactive extension and package manager for [Pi](https://github.com/nicholasgasior/pi-coding-agent).

Provides an `/ext` command to manage local extensions and community packages from within Pi.

## Install

```bash
pi install npm:pi-extension-manager
```

## Usage

```
/ext              Open interactive manager
/ext show         Summarize current state
/ext list         List local extensions
/ext installed    List installed packages
/ext install <s>  Install a package (npm:, git:, or path)
/ext remove <s>   Remove a package
/ext update [s]   Update one or all packages
/ext remote       Browse community packages
/ext auto-update  Configure auto-update schedule
/ext history      Show change history
/ext verify       Check runtime dependencies
/ext path         Show config and data paths
/ext reset        Reset settings
/ext help         Show help
```

## Interactive manager

The main `/ext` view shows local extensions and installed packages in a unified list with:

- Type-to-filter search (plain text, `/path`, `@source`)
- View modes: Tab cycles by-source / A-Z / active-first
- Toggle extensions with Space/Enter
- Package actions: update, remove, configure

## License

MIT
