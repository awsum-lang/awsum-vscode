# Awsum language support for Visual Studio Code

## Features

- **Syntax highlighting** — TextMate grammar for `.aww` files (type declarations, constructors, pattern matching, type parameters, qualified names, comments, strings, integer literals)
- **Code formatting** — runs `awsum format` on save
- **Error diagnostics** — inline red underlines from `awsum check --json`, updated on open, save, and as-you-type
- **Outline & navigation** — Outline view, breadcrumbs, and `Ctrl+Shift+O` / `@` symbol search powered by `awsum symbols --json`
- **Workspace symbol search** — `Ctrl+T` searches all top-level declarations across every `.aww` file in the workspace; the index refreshes automatically on save / create / delete

## Prerequisites

- Install `awsum` CLI: https://awsum-lang.org
- Make sure that the `awsum` binary is in `$PATH` or specify the path manually:
  - Settings → `Awsum › Format: Path` (e.g. `/usr/local/bin/awsum`).

## Versioning

`awsum-vscode` is versioned 1:1 with the `awsum` compiler — `awsum-vscode` `A.B.C` is built against `awsum` `A.B.C`, full stop. Every `awsum` release ships a matching extension release the same day, even when the extension itself has no changes; conversely, the extension is never released ahead of the compiler. If you need to ship a fix that's purely on the extension side, it waits for the next `awsum` release.

The reason is unfortunate but unavoidable: Visual Studio Marketplace only accepts plain semver `A.B.C` (no 4th segment, no pre-release tags in the version that gets shown to users), so we can't iterate the extension independently under a fixed compiler version (`A.B.C-1`, `A.B.C-2`, …) while still publishing to Marketplace. Locking the extension version to the compiler version is the simplest scheme that keeps both registries happy and makes "which `awsum` does this extension want?" trivial to answer.

Only the latest `awsum` release is supported. If your `awsum` version is older, either update `awsum` or pick a matching extension build through VSCode's "Install Another Version".

## Usage

- Enable format on save in `settings.json`

```json
{
  "[awsum]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "awsum-lang.awsum-vscode"
  }
}
```

- Error diagnostics work automatically — open any `.aww` file and errors will appear as red underlines in the editor

## Development

- Install dependencies

```sh
npm i
```

- Package

```sh
npm run package
```

- Manually install `awsum-vscode`: `Cmd + Shift + P` -> `Install from VSIX...`
