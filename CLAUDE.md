# Awsum VSCode Extension

VSCode extension providing syntax highlighting and formatting for the Awsum programming language (`.aww` files).

## Quick Reference

```bash
npm run compile    # Compile TypeScript
npm run package    # Create .vsix package
```

## Structure

```
src/extension.ts              # Main extension (190 lines)
syntaxes/awsum.tmLanguage.json # TextMate grammar
language-configuration.json    # Comment/bracket config
dist/extension.js             # Compiled output
```

## Features

- **Syntax Highlighting**: Full TextMate grammar
  - Comments: `--` (line), `{- -}` (block, nested)
  - Strings with escape sequences
  - Type signatures and function definitions
  - Module-qualified names

- **Formatting**: Via external `awsum` CLI
  - Invokes `awsum format <file>`
  - Preserves EOL style and trailing newline semantics
  - Configurable binary path

## Configuration

```json
{
  "awsum.format.path": "awsum"  // Path to awsum binary
}
```

## Extension Architecture

- No Language Server (LSP) - lightweight design
- Formatting via DocumentFormattingEditProvider
- Temp file approach (CLI expects file path)
- Proper cancellation token support

## Publishing

```bash
npm run package              # Creates awsum-vscode-X.X.X.vsix
code --install-extension awsum-vscode-X.X.X.vsix
```

## Related Repositories

- Compiler: `awsum` (../awsum)
- Website: `awsum-lang.org` (../awsum-lang.org)
