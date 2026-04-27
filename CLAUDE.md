# `awsum-vscode`

`awsum-vscode` is the VSCode extension for Awsum (`.aww` files): syntax highlighting, formatting, diagnostics, and document symbols — all backed by the external `awsum` CLI (no LSP).

## Quick Reference

```bash
npm run compile    # Compile TypeScript
npm run package    # Create .vsix package
```

## Structure

```
src/extension.ts              # Main extension (formatter, diagnostics, symbols)
syntaxes/awsum.tmLanguage.json # TextMate grammar
language-configuration.json    # Comment/bracket config
dist/extension.js             # Compiled output
```

## Features

- **Syntax Highlighting**: Full TextMate grammar
  - Comments: `--` (line), `{- -}` (block, nested)
  - Strings with escape sequences
  - Integer literals (positive and negative)
  - Type signatures and function definitions
  - Type declarations with type parameters and constructor definitions
  - Module-qualified names
  - `case`/`of` keywords and pattern matching

- **Formatting**: Via external `awsum` CLI
  - Invokes `awsum format <file>`
  - Preserves EOL style and trailing newline semantics
  - Configurable binary path
  - Triggered by the standard `editor.formatOnSave` setting

- **Diagnostics (inline errors and warnings)**: Invokes `awsum check --json`
  - On open / save / text change (debounced 500ms)
  - Parses JSON diagnostics, pushes to `DiagnosticCollection`
  - Reads the optional `severity` field (`"error"` | `"warning"`); maps to `vscode.DiagnosticSeverity` so warnings render yellow per theme
  - Writes the current buffer (possibly unsaved) to a temp file so checks see the latest content

- **Quick fixes (lightbulb code actions)**: powered by the optional `fixes` array on each diagnostic
  - Compiler-supplied: extension does no language-aware reasoning, just renders titles + applies `WorkspaceEdit`s straight from the JSON payload
  - Stored in a `FixesIndex` keyed by `(uri, range)` since `vscode.Diagnostic` has no place to stash structured payloads
  - Currently the unused-parameter warning ships two fixes: replace with `_` (drop the binding) or rename to `_name` (document as intentionally unused)

- **Document symbols**: Invokes `awsum symbols --json`
  - Provides Outline panel, breadcrumbs, `Ctrl+Shift+O` / `@` symbol search
  - Kinds: function / constant / type (enum-like)
  - Sig + FunDef with the same name merged into one symbol (range spans both, selection range is just the name)

- **Workspace symbols** (`Ctrl+T`): indexes all `.aww` in the workspace
  - Initial index built on activation via `vscode.workspace.findFiles("**/*.aww", ...)`
  - Maintained incrementally by `FileSystemWatcher` (create/change/delete) and `onDidSaveTextDocument`
  - Case-insensitive substring filter; VS Code applies fuzzy ranking on top
  - Flattens hierarchical children depth-first (ready for future constructor symbols)

## Configuration

```json
{
  "awsum.format.path": "awsum" // Path to `awsum` binary (shared by formatter, check, symbols)
}
```

## Extension Architecture

- No Language Server (LSP) — lightweight CLI-based design
- Six providers: `DocumentFormattingEditProvider`, `DocumentSymbolProvider`, `WorkspaceSymbolProvider`, `DiagnosticCollection` (push-based), `CodeActionProvider` (reads compiler-supplied fixes), plus TextMate grammar for highlighting
- Temp file approach: CLI expects file paths, extension writes current buffer to a tempdir per invocation
- Workspace symbol index runs on disk (not unsaved buffers) — refreshed on save + filesystem watcher events
- Proper cancellation token support on formatting + document symbols

## Publishing

```bash
npm run package              # Creates awsum-vscode-A.B.C.vsix
code --install-extension awsum-vscode-A.B.C.vsix
```

## Related Repositories

- Compiler: `awsum` (../awsum)
- Website: `awsum-lang.org` (../awsum-lang.org)
