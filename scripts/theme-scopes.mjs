// Lists the scopes that the default color themes of VS Code give a color, and
// checks the grammars of the layers against them. The themes come from the
// sources of VS Code at the version in engines.vscode: the default dark and
// light themes of workbenchThemeService.ts, with the themes they include.
//
//   node scripts/theme-scopes.mjs
//
// It prints every simple selector (one scope, no descendants) that both
// default themes color, then checks that every scope of
// syntaxes/awsum-layerN.tmLanguage.json is one of them with `.awsum` appended.
// meta.* and punctuation.* are exempt: TextMate uses meta.* for containers,
// and the themes give punctuation no color of its own, so it takes the color
// of the scope around it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(extension, "package.json"), "utf8"));
const pinned = /^\^?(\d+\.\d+\.\d+)$/.exec(pkg.engines.vscode);
if (!pinned) {
  console.log(`FAIL: engines.vscode is ${pkg.engines.vscode}, not a version such as ^1.125.0`);
  process.exit(1);
}
const version = pinned[1];

async function source(path) {
  const url = `https://raw.githubusercontent.com/microsoft/vscode/${version}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

// Theme files are JSON with comments and trailing commas.
function jsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text.startsWith("/*", i)) {
      i = text.indexOf("*/", i) + 2;
    } else {
      out += text[i++];
    }
  }
  return JSON.parse(out.replace(/,(\s*[\]}])/g, "$1"));
}

const themesDir = "extensions/theme-defaults";
const service = await source("src/vs/workbench/services/themes/common/workbenchThemeService.ts");
const contributed = jsonc(await source(`${themesDir}/package.json`)).contributes.themes;

// The token color rules of a theme, those of the themes it includes first.
async function rules(path) {
  const theme = jsonc(await source(path));
  const included = theme.include ? await rules(posix.join(posix.dirname(path), theme.include)) : [];
  return [...included, ...(theme.tokenColors ?? [])];
}

async function selectors(kind) {
  const label = new RegExp(`COLOR_THEME_${kind} = '([^']+)'`).exec(service)?.[1];
  const theme = contributed.find((t) => (t.id ?? t.label) === label);
  if (!theme) throw new Error(`no default ${kind.toLowerCase()} theme in VS Code ${version}`);
  const scopes = (await rules(posix.join(themesDir, theme.path))).flatMap((rule) =>
    Array.isArray(rule.scope) ? rule.scope : (rule.scope ?? "").split(","),
  );
  return { label, simple: new Set(scopes.map((s) => s.trim()).filter((s) => s && !s.includes(" "))) };
}

const dark = await selectors("DARK");
const light = await selectors("LIGHT");
const colored = new Set([...dark.simple].filter((s) => light.simple.has(s)));
console.log(`Scopes that ${dark.label} and ${light.label} color in VS Code ${version}:`);
for (const s of [...colored].sort()) console.log(`  ${s}`);

const problems = [];
for (const file of readdirSync(join(extension, "syntaxes")).filter((f) => /^awsum-layer\d+\.tmLanguage\.json$/.test(f)).sort()) {
  const grammar = JSON.parse(readFileSync(join(extension, "syntaxes", file), "utf8"));
  const names = new Set();
  (function walk(node) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (typeof node.name === "string" && node !== grammar) names.add(node.name);
      Object.values(node).forEach(walk);
    }
  })(grammar);
  for (const name of [...names].sort()) {
    if (name.startsWith("meta.") || name.startsWith("punctuation.")) continue;
    if (!name.endsWith(".awsum") || !colored.has(name.slice(0, -".awsum".length)))
      problems.push(`syntaxes/${file}: ${name} is not a scope the default themes color, with .awsum`);
  }
}
for (const problem of problems) console.log(`FAIL: ${problem}`);
console.log(`${colored.size} scopes; ${problems.length} problems`);
process.exit(problems.length === 0 ? 0 : 1);
