# Awsum language support for Visual Studio Code

## Prerequisites

- Install `awsum` CLI: https://awsum-lang.org
- Make sure tha the `awsum` binary is in `$PATH` or specify the path manually:
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
