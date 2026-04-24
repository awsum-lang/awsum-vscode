# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The extension follows a versioning scheme `vD.E.F-awsum-vA.B.C` where `D.E.F` is the extension's own SemVer and `A.B.C` is the `awsum` compiler version it targets.

## [Unreleased]

## [0.0.1-awsum-0.0.2] - 2026-04-24

First release under the `vD.E.F-awsum-vA.B.C` versioning scheme, which explicitly pins each extension release to a compatible `awsum` compiler version. Compatible with `awsum` v0.0.2.

### Added

- **Syntax highlighting** — TextMate grammar for `.aww`:
  - Comments: `--` (line), `{- -}` (block, nested)
  - String literals with escape sequences
  - Integer literals
  - Type signatures and function definitions
  - Type declarations with type parameters and constructor definitions
  - Module-qualified names
  - `case` / `of` keywords and pattern matching
  - `_`-prefixed identifiers (underscore convention for intentionally-unused bindings)
  - `(++)` as a function name at the definition site

- **Formatting** — `DocumentFormattingEditProvider` shelling out to `awsum format`
  - Triggered by the standard `editor.formatOnSave` setting
  - Configurable binary path via `awsum.format.path`

- **Inline diagnostics** — red (errors) and yellow (warnings) squigglies from `awsum check --json`
  - Refresh on open, save, and text change (debounced 500 ms)
  - Writes the current buffer to a temp file so diagnostics see unsaved content
  - Theme-aware severity via `DiagnosticSeverity.Error` / `Warning`

- **Quick fixes** — lightbulb code actions supplied by the compiler via the `fixes` array on each diagnostic
  - Extension does no language-aware reasoning; titles and `WorkspaceEdit`s come straight from the JSON payload
  - Covers the unused-parameter warning (replace with `_`, or rename to `_name`)

- **Outline & navigation** — `DocumentSymbolProvider` backed by `awsum symbols --json`
  - Powers Outline view, breadcrumbs, `Ctrl+Shift+O` / `@` in-file symbol search
  - Merges `Sig` + `FunDef` with the same name into one symbol

- **Workspace symbol search** — `WorkspaceSymbolProvider` (`Ctrl+T`)
  - Initial index via `vscode.workspace.findFiles("**/*.aww", ...)`
  - Maintained incrementally by `FileSystemWatcher` and `onDidSaveTextDocument`
  - Case-insensitive substring filter; VS Code applies fuzzy ranking on top

- **Icons** — extension icon and `.aww` file icon (light + dark variants)
