## [0.8.1](https://github.com/victor-software-house/pi-extension-manager/compare/v0.8.0...v0.8.1) (2026-03-31)


### Bug Fixes

* use relative path for README screenshot ([ffa4e19](https://github.com/victor-software-house/pi-extension-manager/commit/ffa4e192bd1d2017197603bb9c94582aa753cd6c))

# [0.8.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.7.1...v0.8.0) (2026-03-31)


### Features

* selective updates — only update outdated packages by default ([e1f6e1a](https://github.com/victor-software-house/pi-extension-manager/commit/e1f6e1afb6fc860524001ae5aaf32bd00face73f))

## [0.7.1](https://github.com/victor-software-house/pi-extension-manager/compare/v0.7.0...v0.7.1) (2026-03-31)


### Bug Fixes

* filter remote packages across all results, not just current page ([eb7d62d](https://github.com/victor-software-house/pi-extension-manager/commit/eb7d62d26a655b0d4982b182fefb192c132dc0ec))

# [0.7.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.6.1...v0.7.0) (2026-03-31)


### Bug Fixes

* stop pre-truncating descriptions in remote browse ([7d196fe](https://github.com/victor-software-house/pi-extension-manager/commit/7d196fee36790c3dc4107da618658089c1058393))


### Features

* add client-side search filter to remote browse panel ([757847d](https://github.com/victor-software-house/pi-extension-manager/commit/757847d1c022cab367222cd1aa9b8192eb5aeda9))

## [0.6.1](https://github.com/victor-software-house/pi-extension-manager/compare/v0.6.0...v0.6.1) (2026-03-31)


### Bug Fixes

* truncate shortcut hint line to terminal width ([6b20903](https://github.com/victor-software-house/pi-extension-manager/commit/6b20903aa2554e32ef10337711e422563ecbcd6a))

# [0.6.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.5.3...v0.6.0) (2026-03-28)


### Features

* release deferred reload flow and wrap navigation ([554b028](https://github.com/victor-software-house/pi-extension-manager/commit/554b028980822287eead86b88388f2de4800dad2))

## [0.5.3](https://github.com/victor-software-house/pi-extension-manager/compare/v0.5.2...v0.5.3) (2026-03-28)


### Bug Fixes

* separate Space (toggle) from Enter (actions), return to list after sub-actions ([b599151](https://github.com/victor-software-house/pi-extension-manager/commit/b599151ac31f3ea1cf36729fa1897e7e03c7773f))

## [0.5.2](https://github.com/victor-software-house/pi-extension-manager/compare/v0.5.1...v0.5.2) (2026-03-28)


### Bug Fixes

* Enter/Space acts on selected item even during active search ([34f41f1](https://github.com/victor-software-house/pi-extension-manager/commit/34f41f1b288e7a478314d3be8714820d50af70f5))

## [0.5.1](https://github.com/victor-software-house/pi-extension-manager/compare/v0.5.0...v0.5.1) (2026-03-28)


### Bug Fixes

* restore Enter key for toggle/actions with explicit \r/\n match ([a01168a](https://github.com/victor-software-house/pi-extension-manager/commit/a01168a19d3fc09bf6f3e0beb9a5ec0189272571))

# [0.5.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.4.0...v0.5.0) (2026-03-28)


### Features

* restore original shortcuts, /search activation, enable/disable commands ([df99ba3](https://github.com/victor-software-house/pi-extension-manager/commit/df99ba365586f7548327587f60ca470eebcc796b))

# [0.4.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.3.2...v0.4.0) (2026-03-28)


### Features

* add show, verify, path, reset, help commands (RTK pattern) ([a822abc](https://github.com/victor-software-house/pi-extension-manager/commit/a822abcb2b9a107288b6758e805f249d2328055c))

## [0.3.2](https://github.com/victor-software-house/pi-extension-manager/compare/v0.3.1...v0.3.2) (2026-03-28)


### Bug Fixes

* single-letter shortcuts only activate when search is empty ([1dfc9bc](https://github.com/victor-software-house/pi-extension-manager/commit/1dfc9bcbae7e998d969351cbfde719634a7df235))

## [0.3.1](https://github.com/victor-software-house/pi-extension-manager/compare/v0.3.0...v0.3.1) (2026-03-28)


### Bug Fixes

* trigger release ([a6a9e2e](https://github.com/victor-software-house/pi-extension-manager/commit/a6a9e2edfd9ee8c75883375200f984719b40f42f))

# [0.3.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.2.0...v0.3.0) (2026-03-28)


### Features

* rename /ext command to /extensions ([e65224e](https://github.com/victor-software-house/pi-extension-manager/commit/e65224e4cfea6e1da134bed875b04cb52d5e85be))

# [0.2.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.1.0...v0.2.0) (2026-03-28)


### Bug Fixes

* organize imports, apply biome autofix ([6f44307](https://github.com/victor-software-house/pi-extension-manager/commit/6f44307376fc39cf19ee6bd41bf635cac83a52a2))
* remove unused showInstalledPackagesLegacy import ([4a17061](https://github.com/victor-software-house/pi-extension-manager/commit/4a17061ee8bfaa02747b407930bf655853408311))


### Features

* phase 3 — custom TUI manager panel (pi-skills-manager pattern) ([24b3b58](https://github.com/victor-software-house/pi-extension-manager/commit/24b3b58e71ae34c92ced1cda0e56691addc3d56f))
* phase 4 — remote browsing cleanup, delete dead files ([9c28449](https://github.com/victor-software-house/pi-extension-manager/commit/9c28449fcfe56d3b4fd6491ecf79cbb560ab7231))
* phase 5 — history Zod schema, drop JSONL walking, fix type safety ([0497942](https://github.com/victor-software-house/pi-extension-manager/commit/0497942fa6c95ba43c9ca5d44ddeb939ca9ef24b))

# [0.2.0](https://github.com/victor-software-house/pi-extension-manager/compare/v0.1.0...v0.2.0) (2026-03-28)


### Bug Fixes

* organize imports, apply biome autofix ([6f44307](https://github.com/victor-software-house/pi-extension-manager/commit/6f44307376fc39cf19ee6bd41bf635cac83a52a2))
* remove unused showInstalledPackagesLegacy import ([4a17061](https://github.com/victor-software-house/pi-extension-manager/commit/4a17061ee8bfaa02747b407930bf655853408311))


### Features

* phase 3 — custom TUI manager panel (pi-skills-manager pattern) ([24b3b58](https://github.com/victor-software-house/pi-extension-manager/commit/24b3b58e71ae34c92ced1cda0e56691addc3d56f))
* phase 4 — remote browsing cleanup, delete dead files ([9c28449](https://github.com/victor-software-house/pi-extension-manager/commit/9c28449fcfe56d3b4fd6491ecf79cbb560ab7231))
* phase 5 — history Zod schema, drop JSONL walking, fix type safety ([0497942](https://github.com/victor-software-house/pi-extension-manager/commit/0497942fa6c95ba43c9ca5d44ddeb939ca9ef24b))
