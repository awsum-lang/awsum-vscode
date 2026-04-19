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

- Install the extension manually: `Cmd + Shift + P` -> `Install from VSIX...`
