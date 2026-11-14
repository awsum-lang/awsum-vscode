// Checks the TextMate grammars of the layers of Awsum as this extension ships
// them, with the engine VSCode uses (vscode-textmate and vscode-oniguruma;
// `npm install` first). The layers come from the sibling checkout of
// awsum-lang/awsum, ../awsum: layerN keeps its grammar in
// layerN/awsum.tmLanguage.json, this extension ships a copy of it as the grammar
// source.awsum.layerN, and syntaxes/awsum.tmLanguage.json picks the grammar of
// a layer by the first line of a file, `# awsum layerN`, and the newest layer's
// for a file without it.
//
//   node scripts/check-grammars.mjs [FILE...]
//
// For every layer: the copy is the same as the layer's grammar, the first line
// picks it, and every program of the layer that is not a syntax error tokenizes
// without an invalid token, every token but whitespace getting a scope that says
// what it is, not only the containers source.* and meta.*. By default the programs are those in the directories that
// LAYERS lists for the layer. It also reports how many of the layer's syntax
// errors the grammar marks as invalid, for information.
import vsctm from "vscode-textmate";
import onig from "vscode-oniguruma";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The directories of the programs of each layer, relative to the layer's:
// `programs` that are not syntax errors, and `syntaxErrors`. A new layer adds
// its entry.
const LAYERS = {
  0: {
    programs: ["compiler/src", "tests/static-errors", "tests/runtime-errors", "tests/success"],
    syntaxErrors: ["tests/syntax-errors"],
  },
};

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const awsum = resolve(extension, "..", "awsum");
const workspace = dirname(extension);
if (!existsSync(awsum)) {
  console.log(`FAIL: no checkout of awsum-lang/awsum next to this one, at ${awsum}`);
  process.exit(1);
}

const shown = (path) => relative(workspace, path);
const problems = [];
const fail = (message) => problems.push(message);

// The numbers of the layers among `names`, by `pattern`, in order.
const numbers = (names, pattern) =>
  names.map((name) => pattern.exec(name)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
const layers = numbers(readdirSync(awsum), /^layer(\d+)$/);
const newest = layers[layers.length - 1];
const layerDir = (n) => join(awsum, `layer${n}`);
const layerScope = (n) => `source.awsum.layer${n}`;

// The grammars as VSCode loads them.
const pkg = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
const grammarPaths = Object.fromEntries(pkg.contributes.grammars.map((g) => [g.scopeName, join(extension, g.path)]));

const dispatcherPath = grammarPaths["source.awsum"];
const dispatcher = JSON.parse(readFileSync(dispatcherPath, "utf8")).patterns;
const includesOnly = (pattern, n) =>
  pattern.end === "(?!)" && pattern.patterns?.length === 1 && pattern.patterns[0].include === layerScope(n);
const fallback = dispatcher[dispatcher.length - 1];
if (!(fallback?.begin === "\\A" && includesOnly(fallback, newest)))
  fail(`${shown(dispatcherPath)}: the last pattern does not give a file without \`# awsum layerN\` to layer${newest}`);
// Every list of layers names the layers of ../awsum, no more and no fewer.
const lists = [
  [`${shown(join(extension, "package.json"))}, grammars`, numbers(Object.keys(grammarPaths), /^source\.awsum\.layer(\d+)$/)],
  [`${shown(dispatcherPath)}, first lines`, numbers(dispatcher.map((p) => p.begin ?? ""), /^\\A\(\?=# awsum layer(\d+)\$\)$/)],
  [`${shown(fileURLToPath(import.meta.url))}, LAYERS`, numbers(Object.keys(LAYERS), /^(\d+)$/)],
];
for (const [where, list] of lists)
  if (list.join() !== layers.join())
    fail(`${where}: layers ${list.join(", ") || "none"}, but ${shown(awsum)} has ${layers.join(", ")}`);
for (const n of layers) {
  const source = join(layerDir(n), "awsum.tmLanguage.json");
  const copy = grammarPaths[layerScope(n)];
  if (copy && readFileSync(copy, "utf8") !== readFileSync(source, "utf8")) fail(`${shown(copy)} differs from ${shown(source)}`);
  const pick = dispatcher.find((p) => p.begin === `\\A(?=# awsum layer${n}$)`);
  if (pick && !includesOnly(pick, n))
    fail(`${shown(dispatcherPath)}: the first line \`# awsum layer${n}\` does not pick ${layerScope(n)}`);
}

await onig.loadWASM(readFileSync(join(extension, "node_modules", "vscode-oniguruma", "release", "onig.wasm")).buffer);
const registry = new vsctm.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new onig.OnigScanner(patterns),
    createOnigString: (s) => new onig.OnigString(s),
  }),
  loadGrammar: async (scope) => {
    const path = grammarPaths[scope];
    return path ? vsctm.parseRawGrammar(readFileSync(path, "utf8"), path) : null;
  },
});
const grammar = await registry.loadGrammar("source.awsum");

const awsumFiles = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".awsum")).sort().map((f) => join(dir, f));

// The programs of layer n in the directories `fragments` of LAYERS names.
function layerFiles(n, fragments) {
  return fragments.flatMap((fragment) => {
    const dir = join(layerDir(n), fragment);
    if (existsSync(dir)) return awsumFiles(dir);
    fail(`${shown(fileURLToPath(import.meta.url))}, LAYERS: layer${n} has no directory ${fragment}`);
    return [];
  });
}

// The problems of one program, each "LINE: message".
function check(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const header = /^# awsum layer(\d+)$/.exec(lines[0]);
  const n = header ? Number(header[1]) : newest;
  if (!layers.includes(n)) return [`1: the first line names layer${n}, which ${shown(awsum)} does not have`];
  const found = [];
  let state = vsctm.INITIAL;
  lines.forEach((line, i) => {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    for (const t of result.tokens) {
      const text = line.slice(t.startIndex, t.endIndex);
      const invalid = t.scopes.find((scope) => scope.startsWith("invalid"));
      if (invalid) found.push(`${i + 1}: ${invalid}: ${JSON.stringify(text)}`);
      const container = (scope) => scope.startsWith("source.") || scope.startsWith("meta.");
      if (/\S/.test(text) && t.scopes.every(container))
        found.push(`${i + 1}: no scope but ${t.scopes.join(" ")}: ${JSON.stringify(text)}`);
    }
  });
  return found;
}

// A layer without an entry in LAYERS is reported above.
const described = layers.filter((n) => LAYERS[n]);
const files = process.argv.length > 2
  ? process.argv.slice(2).map((f) => resolve(f))
  : described.flatMap((n) => layerFiles(n, LAYERS[n].programs));
for (const file of files) for (const problem of check(file)) fail(`${shown(file)}:${problem}`);

const marked = described.map((n) => {
  const cases = layerFiles(n, LAYERS[n].syntaxErrors);
  const invalid = cases.filter((f) => check(f).some((p) => / invalid\./.test(p))).length;
  return `layer${n}: the grammar marks ${invalid} of ${cases.length} syntax errors as invalid`;
});

for (const problem of problems) console.log(`FAIL: ${problem}`);
console.log(`${files.length} files checked, ${problems.length} problems; ${marked.join("; ")}`);
process.exit(problems.length === 0 ? 0 : 1);
