# `awsum-vscode`

`awsum-vscode` is the VSCode extension for Awsum (`.aww` files). It is a thin LSP client to the bundled `awsum lsp` server — every diagnostic, code action, format edit, document symbol, and workspace symbol is computed inside the `awsum` compiler binary and pushed over LSP.

## Quick Reference

```bash
npm run compile    # Compile TypeScript
npm run package    # Create .vsix package
```

## Structure

```
src/extension.ts                # LSP client (vscode-languageclient → awsum lsp)
syntaxes/awsum.tmLanguage.json  # TextMate grammar (VS Code's primary highlighter)
language-configuration.json     # Comment / bracket / auto-close config
dist/extension.js               # Compiled output
```

## Features (all delivered through `awsum lsp`)

- **Syntax Highlighting** — TextMate grammar.
- **Format on save** — `textDocument/formatting`. Triggered by the standard `editor.formatOnSave` setting (enabled by default for the `awsum` language via `contributes.configurationDefaults` in `package.json`).
- **Diagnostics** — `textDocument/publishDiagnostics`. Pushed on open / save / change (debounced 500 ms server-side). Severity (`error` vs `warning`) honoured by the VS Code Problems panel.
- **Quick Fixes (lightbulb)** — `textDocument/codeAction`. Compiler-supplied fixes only; the extension does no language-aware reasoning.
- **Document Symbols** — `textDocument/documentSymbol`. Drives the Outline panel, breadcrumbs, and `Ctrl+Shift+O` symbol search.
- **Workspace Symbols (`Ctrl+T`)** — `workspace/symbol`. The server walks every `.aww` under the workspace folders received at `initialize`.

## Configuration

```json
{
  "awsum.path": "awsum" // Path to the `awsum` binary; spawned as `awsum lsp` for the LSP server.
}
```

A change to this setting restarts the LSP client automatically — no editor reload required.

## Architecture

- **Single source of truth.** `awsum-vscode` does no language-aware processing. All semantics live in `awsum/src/Awsum/Lsp.hs` (the LSP server) and the modules it reuses (`Awsum.Diagnostic`, `Awsum.Symbols`, `Awsum.Format`, `Awsum.ElaborateLower`, …).
- **Lockstep versioning.** `awsum-vscode A.B.C` ↔ `awsum A.B.C` ↔ `awsum-zed A.B.C`. One version, multiple artefacts. The LSP server lives inside the same `awsum` binary the user installs as the CLI; there is no separate `awsum-lsp` to version-skew against.
- **No custom providers.** Everything routes through `vscode-languageclient` standard handlers. Anything you'd want to add for VS Code is best added on the LSP server side first — that way `awsum-zed`, Helix, and any other LSP client benefit too.

## Publishing

```bash
npm run package              # Creates awsum-vscode-A.B.C.vsix
code --install-extension awsum-vscode-A.B.C.vsix
```
