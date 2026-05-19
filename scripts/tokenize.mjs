// Tokenize a single `.aww` file via `vscode-textmate` (the same engine
// VSCode uses in production) against this extension's TextMate grammar.
// Prints a JSON document to stdout describing every token's source range
// and full scope stack.
//
// Output shape:
//   [
//     { "line": 0, "tokens": [{ "start": 0, "end": 6, "text": "type", "scopes": ["source.awsum", "keyword.other.type-definition.awsum"] }, ...] },
//     ...
//   ]
//
// `start` and `end` are vscode-textmate's native UTF-16-code-unit
// indices into the line — kept for debugging only. The `text` field
// is what consumers should match against, because Haskell's
// `Data.Text` indexes by code point and would silently miscount any
// supplementary-plane character (e.g. `𰎝`).
//
// Used by `awsum/test/Awsum/TextMateSpec.hs` (gated behind the
// `textmate-tests` cabal flag) to assert TextMate-grammar invariants
// (keywords get `keyword.*` scope, strings don't leak past `"`, etc.).
//
// Usage: `node scripts/tokenize.mjs <path-to-aww-file>`.

import vsctm from "vscode-textmate";
import oniguruma from "vscode-oniguruma";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = resolve(here, "..", "syntaxes", "awsum.tmLanguage.json");
const wasmPath = resolve(here, "..", "node_modules", "vscode-oniguruma", "release", "onig.wasm");

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write("usage: node scripts/tokenize.mjs <path-to-aww-file>\n");
    process.exit(2);
  }

  const wasmBin = await readFile(wasmPath);
  await oniguruma.loadWASM(wasmBin);
  const onigLib = Promise.resolve({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s),
  });

  const registry = new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      if (scopeName !== "source.awsum") return null;
      const raw = await readFile(grammarPath, "utf-8");
      return vsctm.parseRawGrammar(raw, grammarPath);
    },
  });

  const grammar = await registry.loadGrammar("source.awsum");
  if (!grammar) {
    process.stderr.write("failed to load grammar source.awsum\n");
    process.exit(3);
  }

  const text = await readFile(inputPath, "utf-8");
  const lines = text.split(/\r?\n/);
  const out = [];
  let ruleStack = vsctm.INITIAL;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const r = grammar.tokenizeLine(line, ruleStack);
    out.push({
      line: i,
      tokens: r.tokens.map((t) => ({
        start: t.startIndex,
        end: t.endIndex,
        text: line.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
      })),
    });
    ruleStack = r.ruleStack;
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + "\n");
  process.exit(1);
});
