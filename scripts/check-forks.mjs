// Compute the minimum VS Code version and check package.json against it.
//
// The minimum is the newest VS Code version that (1) every supported fork can
// run — Cursor, Windsurf, VSCodium — and (2) has an `@types/vscode` release
// that has passed the 7-day cooldown. `engines.vscode` and `@types/vscode`
// must both name exactly that version. Each fork's base comes from public data
// only, so the check needs no editor installed:
//   - VSCodium: its GitHub release tag (`1.143.17232` → 1.143).
//   - Windsurf: `productVersion` in its public update feed.
//   - Cursor: `vscodeVersion` in `product.json` inside its official download,
//     read with HTTP range requests (the zip index plus that one file).
//
// Run from the repo root: `node scripts/check-forks.mjs`.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const UA = { "User-Agent": "awsum-vscode-fork-check/1.0" };

async function json(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function range(url, start, end) {
  const res = await fetch(url, { headers: { ...UA, Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`${url}: expected 206 for a range request, got ${res.status}`);
  const total = Number(res.headers.get("content-range").split("/")[1]);
  return { data: Buffer.from(await res.arrayBuffer()), total };
}

// Read one file out of a remote zip: end-of-central-directory record →
// central directory → local header → the entry's (deflated) data.
async function readRemoteZipEntry(url, suffix) {
  const { total } = await range(url, 0, 0);
  const tailLen = Math.min(total, 65_557);
  const { data: tail } = await range(url, total - tailLen, total - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`${url}: no zip end-of-central-directory record`);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const { data: cd } = await range(url, cdOffset, cdOffset + cdSize - 1);
  for (let p = 0; p < cd.length; ) {
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    if (name.endsWith(suffix)) {
      const { data: lh } = await range(url, localOffset, localOffset + 29);
      const dataStart = localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const { data: body } = await range(url, dataStart, dataStart + compSize - 1);
      if (method === 0) return body;
      if (method === 8) return inflateRawSync(body);
      throw new Error(`${name}: unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${url}: no entry ending in ${suffix}`);
}

const minor = (v) => v.split(".").slice(0, 2).join(".");
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] - y[0] || x[1] - y[1];
};

async function vscodium() {
  const rel = await json("https://api.github.com/repos/VSCodium/vscodium/releases/latest");
  return { release: rel.tag_name, vscode: minor(rel.tag_name) };
}

async function windsurf() {
  const feed = await json("https://windsurf-stable.codeium.com/api/update/darwin-arm64/stable/latest");
  return { release: feed.windsurfVersion, vscode: minor(feed.productVersion) };
}

async function cursor() {
  const feed = await json(
    "https://api2.cursor.sh/updates/api/update/darwin-arm64/cursor/1.0.0/0000000000000000000000000000000000000000/stable",
  );
  const product = JSON.parse(await readRemoteZipEntry(feed.url, "Contents/Resources/app/product.json"));
  return { release: product.version, vscode: minor(product.vscodeVersion) };
}

// Newest `@types/vscode` release at or below `ceiling` that is at least 7 days old.
async function typesVersion(ceiling) {
  const meta = await json("https://registry.npmjs.org/@types/vscode");
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const eligible = Object.keys(meta.versions)
    .filter((v) => !v.includes("-") && cmp(minor(v), ceiling) <= 0 && Date.parse(meta.time[v]) <= cutoff)
    .sort((a, b) => cmp(a, b) || Number(a.split(".")[2]) - Number(b.split(".")[2]));
  return eligible.at(-1);
}

const forks = { Cursor: await cursor(), Windsurf: await windsurf(), VSCodium: await vscodium() };
for (const [name, f] of Object.entries(forks)) {
  console.log(`${name.padEnd(9)} ${f.release.padEnd(14)} → VS Code ${f.vscode}`);
}
const lowest = Object.values(forks).map((f) => f.vscode).sort(cmp)[0];
const types = await typesVersion(lowest);
const want = minor(types);
console.log(`\nLowest fork base: ${lowest}. Newest @types/vscode at or below it, past the cooldown: ${types}.`);
console.log(`Minimum VS Code version: ${want}.`);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const problems = [];
if (pkg.engines.vscode !== `^${want}.0`) problems.push(`engines.vscode is "${pkg.engines.vscode}", expected "^${want}.0"`);
if (pkg.devDependencies["@types/vscode"] !== `~${types}`) {
  problems.push(`@types/vscode is "${pkg.devDependencies["@types/vscode"]}", expected "~${types}"`);
}
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log("OK — package.json matches.");
