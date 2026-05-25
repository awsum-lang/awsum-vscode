# Awsum language support for Visual Studio Code

VS Code extension for the [Awsum](https://awsum-lang.org) programming language (`.aww` files). A thin LSP client to the `awsum lsp` server bundled with the Awsum compiler — every diagnostic, code action, format edit, document symbol, and workspace symbol is computed inside the `awsum` compiler binary and pushed over LSP.

## Features

- **Syntax highlighting** — TextMate grammar for `.aww` files.
- **Format on save** — `textDocument/formatting`, triggered by the standard `editor.formatOnSave` setting (enabled by default for the `awsum` language via `contributes.configurationDefaults` in `package.json`).
- **Inline diagnostics** — `textDocument/publishDiagnostics`, pushed on open / save / change (debounced 500 ms server-side). `error` vs `warning` severity honoured by the VS Code Problems panel.
- **Quick fixes (lightbulb)** — `textDocument/codeAction`. Compiler-supplied fixes only; the extension does no language-aware reasoning.
- **Document outline** — `textDocument/documentSymbol`. Drives the Outline panel, breadcrumbs, and `Ctrl+Shift+O` symbol search.
- **Workspace symbol search (`Ctrl+T`)** — `workspace/symbol`. The server walks every `.aww` under the workspace folders received at `initialize`.

## Install

1. Install the Awsum compiler (see [awsum-lang/awsum](https://github.com/awsum-lang/awsum)) and ensure `awsum` is on your `PATH`.
2. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=awsum-lang.awsum-vscode) or the [Open VSX Registry](https://open-vsx.org/extension/awsum-lang/awsum-vscode). For a locally-built `.vsix`: `Cmd+Shift+P` → `Extensions: Install from VSIX…`.

If `awsum` is not on your `PATH`, point the extension at the binary via Settings → `awsum.path` (e.g. `/usr/local/bin/awsum`). A change to this setting restarts the LSP client automatically — no editor reload needed.

## Commands

| Command                                | Default keybinding | What it does                                                                     |
| -------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `Awsum: Restart Awsum LSP server`      | —                  | Stops the `awsum lsp` process and starts a new one with the same settings. Useful after a local `stack install` of a new `awsum` build, or to clear any in-memory state on the server. |

Bind it to a keybinding via the standard VS Code Keyboard Shortcuts editor (`awsum.restartLspServer`).

## Versioning

`awsum-vscode A.B.C` is built and tested against `awsum A.B.C`. Mismatched versions are not supported — at startup the LSP server compares the extension's expected version against its own and shows a non-blocking notification on mismatch.

Visual Studio Marketplace only accepts plain semver `A.B.C` (no 4th segment, no pre-release tags), so we can't iterate the extension independently under a fixed compiler version. Every `awsum` release ships a matching extension release (minimum once); the extension is never released ahead of the compiler. Only the latest `awsum` release is supported.

## Development

```bash
npm i               # install dependencies
npm run compile     # type-check via tsc
npm run bundle      # esbuild → dist/extension.js
npm run package     # bundle + vsce package → awsum-vscode-A.B.C.vsix
```

### Structure

```
src/extension.ts                # LSP client (vscode-languageclient → awsum lsp)
syntaxes/awsum.tmLanguage.json  # TextMate grammar
language-configuration.json     # Comment / bracket / auto-close config
dist/extension.js               # Bundled output (esbuild)
```

### Architecture

- **Single source of truth.** `awsum-vscode` does no language-aware processing. All semantics live in `awsum/src/Awsum/Lsp.hs` (the LSP server) and the modules it reuses (`Awsum.Diagnostic`, `Awsum.Symbols`, `Awsum.Format`, `Awsum.ElaborateLower`, …).
- **No custom providers.** Everything routes through `vscode-languageclient` standard handlers. Anything you'd want to add for VS Code is best added on the LSP server side first — that way `awsum-zed`, Helix, and any other LSP client benefit too.

## Related

- Compiler: [awsum-lang/awsum](https://github.com/awsum-lang/awsum)
- Zed extension: [awsum-lang/awsum-zed](https://github.com/awsum-lang/awsum-zed)
- Tree-sitter grammar: [awsum-lang/tree-sitter-awsum](https://github.com/awsum-lang/tree-sitter-awsum)
- Examples: [awsum-lang/awsum-examples](https://github.com/awsum-lang/awsum-examples)
- Website: [awsum-lang.org](https://awsum-lang.org)

## AI use

This VSCode extension is developed with substantial usage of generative AI. Every generated change is reviewed, edited, and accepted by a human before it lands in the repository, and no output is shipped unedited.

## License

Apache 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
