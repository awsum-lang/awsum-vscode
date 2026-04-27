# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

`awsum-vscode` is versioned 1:1 with the `awsum` compiler — the extension's `A.B.C` is exactly the `awsum` `A.B.C` it targets. Visual Studio Marketplace doesn't accept the kind of semver pre-release suffix we'd need to iterate the extension independently under a fixed compiler version, so we collapse the two version axes into one: every `awsum` release ships a matching extension release, the extension is never released ahead of the compiler, and only the latest `awsum` release is supported. (Releases before 0.0.3 used an `A.B.C-N` scheme; the entries below preserve those original tags.)

## [Unreleased]

## [0.0.3] - 2026-04-27

No user-facing changes to the extension itself; this release tracks the compiler version bump and ships the release / supply-chain infrastructure built up since 0.0.1.

### Added

- Release workflow: pushing a `v*` tag builds the extension and publishes a GitHub Release with the `.vsix` attached. Tag and `package.json` version must match, or the run fails before the build.
- Default formatter and format-on-save for `.aww` files are now contributed by the extension itself (via `contributes.configurationDefaults` in `package.json`). Users no longer need to add `"[awsum]": { "editor.formatOnSave": true, "editor.defaultFormatter": "awsum-lang.awsum-vscode" }` to their `settings.json` — these become the defaults the moment the extension is installed, and can still be overridden per user / workspace.

- Build provenance via `actions/attest-build-provenance@v4` on the published `.vsix` — each release asset gets a Sigstore-signed attestation tying it to the release workflow run and the tagged commit. Users verify with `gh attestation verify awsum-vscode-X.Y.Z.vsix --repo awsum-lang/awsum-vscode`.

- `CONTRIBUTING.md` — covers the dev-loop commands, the signed-commits requirement on `main` (with a working `~/.gitconfig` example for SSH signing), and the PR / CHANGELOG conventions.

- `justfile` with a single user-facing `just release` recipe — checks out `main`, pulls, reads the version from `package.json`, asks the operator to type the version back as confirmation (private `manual-confirmation-input` helper), then creates an annotated tag and pushes it. Mirrors the same recipe in `awsum/justfile`.

## [0.0.2] - 2026-04-24

First release under the `A.B.C-N` versioning scheme, which pins each `awsum-vscode` build to a specific `awsum` compiler version. Compatible with `awsum` v0.0.2.

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
