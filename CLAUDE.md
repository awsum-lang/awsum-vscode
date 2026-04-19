# Awsum VSCode Extension

VSCode extension for the Awsum programming language (`.aww` files): syntax highlighting, formatting, diagnostics, and document symbols — all backed by the external `awsum` CLI (no LSP).

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

- **Diagnostics (inline errors)**: Invokes `awsum check --json`
  - On open / save / text change (debounced 500ms)
  - Parses JSON diagnostics, pushes to `DiagnosticCollection`
  - Writes the current buffer (possibly unsaved) to a temp file so checks see the latest content

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
  "awsum.format.path": "awsum" // Path to awsum binary (shared by formatter, check, symbols)
}
```

## Extension Architecture

- No Language Server (LSP) — lightweight CLI-based design
- Five providers: `DocumentFormattingEditProvider`, `DocumentSymbolProvider`, `WorkspaceSymbolProvider`, `DiagnosticCollection` (push-based), plus TextMate grammar for highlighting
- Temp file approach: CLI expects file paths, extension writes current buffer to a tempdir per invocation
- Workspace symbol index runs on disk (not unsaved buffers) — refreshed on save + filesystem watcher events
- Proper cancellation token support on formatting + document symbols

## Publishing

```bash
npm run package              # Creates awsum-vscode-X.X.X.vsix
code --install-extension awsum-vscode-X.X.X.vsix
```

## Related Repositories

- Compiler: `awsum` (../awsum)
- Website: `awsum-lang.org` (../awsum-lang.org)
