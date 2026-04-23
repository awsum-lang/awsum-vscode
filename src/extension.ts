/**
 * Awsum VS Code Extension – Formatting + Diagnostics + Document Symbols
 *
 * Responsibilities:
 *  - Register a DocumentFormattingEditProvider for the Awsum language.
 *  - Invoke the external `awsum` CLI formatter safely and predictably.
 *  - Preserve the document's end-of-line style (LF/CRLF).
 *  - Preserve the "final newline" semantics of the original buffer:
 *      * if the original ended with a newline → leave exactly one;
 *      * otherwise → remove trailing newlines.
 *  - Run `awsum check --json` on open/save/change to provide inline diagnostics.
 *  - Register a DocumentSymbolProvider backed by `awsum symbols --json` to
 *    populate the Outline view, breadcrumbs, and symbol-based navigation.
 *
 * Notes:
 *  - The formatter runs only for files with language id "awsum" (see package.json).
 *  - The binary path is configurable via `awsum.format.path`.
 *  - Cancellation is respected via the VS Code CancellationToken.
 *  - All errors are surfaced to the user via `showErrorMessage` (no silent failures).
 */

import * as vscode from "vscode";
import { execFile } from "child_process";
import * as os from "os";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Extension activation – registers the formatting provider for Awsum documents.
 */
export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = {
    language: "awsum",
    scheme: "file",
  };

  // Formatting provider.
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      selector,
      new AwsumFormattingProvider()
    )
  );

  // Document symbols provider (Outline view, breadcrumbs, @-symbol search).
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(
      selector,
      new AwsumDocumentSymbolProvider()
    )
  );

  // Workspace symbols provider (Ctrl+T: search symbols across all .aww files).
  const workspaceSymbols = new AwsumWorkspaceSymbolProvider();
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbols)
  );
  workspaceSymbols.reindexAll(); // kick off background indexing

  // Keep workspace symbol index in sync with filesystem changes.
  const fsWatcher = vscode.workspace.createFileSystemWatcher("**/*.aww");
  context.subscriptions.push(
    fsWatcher,
    fsWatcher.onDidCreate((uri) => workspaceSymbols.updateFile(uri)),
    fsWatcher.onDidChange((uri) => workspaceSymbols.updateFile(uri)),
    fsWatcher.onDidDelete((uri) => workspaceSymbols.removeFile(uri)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === "awsum" && doc.uri.scheme === "file") {
        workspaceSymbols.updateFile(doc.uri);
      }
    })
  );

  // Diagnostics provider.  We push diagnostics in as the user edits, and
  // attach quick-fix payloads on the side so the CodeActionProvider can
  // surface them without re-invoking the CLI.
  const diagnostics = vscode.languages.createDiagnosticCollection("awsum");
  const fixesIndex = new FixesIndex();
  context.subscriptions.push(diagnostics);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      selector,
      new AwsumCodeActionProvider(fixesIndex),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  const checkDocument = (doc: vscode.TextDocument) => {
    if (doc.languageId === "awsum" && doc.uri.scheme === "file") {
      runAwsumCheck(doc, diagnostics, fixesIndex);
    }
  };

  // Debounced check for text changes (500ms delay to avoid spawning on every keystroke).
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const checkDocumentDebounced = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    const prev = debounceTimers.get(key);
    if (prev) clearTimeout(prev);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        checkDocument(doc);
      }, 500)
    );
  };

  // Check on open, save, and text change.
  vscode.workspace.textDocuments.forEach(checkDocument);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(checkDocument),
    vscode.workspace.onDidSaveTextDocument(checkDocument),
    vscode.workspace.onDidChangeTextDocument((e) => checkDocumentDebounced(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      fixesIndex.clear(doc.uri);
      const key = doc.uri.toString();
      const timer = debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(key);
      }
    })
  );
}

/**
 * DocumentFormattingEditProvider implementation.
 *
 * Strategy:
 *  1) Read the entire buffer and the user's configured `awsum` binary path.
 *  2) Invoke the CLI formatter against a temp file (CLI expects a path).
 *  3) Normalize all line endings to match the current document (LF/CRLF).
 *  4) Reconcile the final-newline semantics with the original buffer.
 *  5) Replace the full document range with the normalized result.
 *
 * Cancellation:
 *  - The underlying process is killed if the token is cancelled.
 */
class AwsumFormattingProvider implements vscode.DocumentFormattingEditProvider {
  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const cfg = vscode.workspace.getConfiguration();
    const bin = (cfg.get<string>("awsum.format.path") || "awsum").trim();

    // Current buffer contents.
    const original = document.getText();

    // Detect the document's preferred EOL.
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const originalEndsWithEol = /\r?\n$/.test(original);

    try {
      const formatted = await formatWithAwsum(bin, original, token);
      if (token.isCancellationRequested || formatted === null) return [];

      // 1) Normalize all line endings to the document's style.
      let normalized = formatted.replace(/\r?\n/g, eol);

      // 2) Align the trailing newline policy with the original buffer:
      //    - if the original ended with EOL → keep exactly one;
      //    - otherwise → remove all trailing EOLs.
      const tailRe = new RegExp(`(?:${escapeForRegExp(eol)})+$`);
      if (originalEndsWithEol) {
        normalized = normalized.replace(tailRe, eol);
      } else {
        normalized = normalized.replace(tailRe, "");
      }

      // 3) Replace the entire document.
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(original.length)
      );

      return [vscode.TextEdit.replace(fullRange, normalized)];
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Awsum format error: ${err?.message ?? String(err)}`
      );
      return [];
    }
  }
}

/**
 * Escape a string for use inside a RegExp literal (classic "escapeRegExp").
 */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Invoke the external formatter.
 *
 * Rationale:
 *  - The CLI currently formats files by path; we therefore write the current
 *    buffer to a dedicated temporary file and call `awsum format <tmp>`.
 *  - The temporary directory is removed in a `finally` block for robustness.
 *  - Cancellation is propagated to the child process via `execFileAsync`.
 */
async function formatWithAwsum(
  awsumBin: string,
  text: string,
  token: vscode.CancellationToken
): Promise<string | null> {
  // Write the buffer to a temp file because the CLI expects a file path.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "awsum-"));
  const tmpPath = path.join(tmpDir, "tmp.aww");

  try {
    await fs.writeFile(tmpPath, text, "utf8");

    const { stdout } = await execFileAsync(awsumBin, ["format", tmpPath], {
      token,
    });

    return stdout.toString();
  } finally {
    // Clean up the temp directory (best-effort).
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Promisified `execFile` with cancellation support.
 *
 * Behavior:
 *  - Resolves with { stdout, stderr } on success.
 *  - Rejects with an Error (stderr or error message) on non-zero exit.
 *  - If a CancellationToken is provided and cancelled, kills the child process.
 */
function execFileAsync(
  file: string,
  args: string[],
  opts: { token?: vscode.CancellationToken } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || String(error)));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );

    if (opts.token) {
      const sub = opts.token.onCancellationRequested(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        sub.dispose();
      });
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Diagnostics
// ────────────────────────────────────────────────────────────────────────────

/**
 * JSON shape returned by `awsum check --json`:
 *   [{ severity?, startLine, startCol, endLine, endCol, message, fixes? }]
 *
 * `severity` defaults to `"error"` when absent (older CLI builds).
 * `fixes` is an optional array of { title, edits: [{range, newText}] }.
 *
 * Positions are 1-based; VS Code expects 0-based.
 */
interface AwsumRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

interface AwsumEdit extends AwsumRange {
  newText: string;
}

interface AwsumFix {
  title: string;
  edits: AwsumEdit[];
}

interface AwsumDiagnostic extends AwsumRange {
  severity?: "error" | "warning";
  message: string;
  fixes?: AwsumFix[];
}

/**
 * Side-table mapping each document to the fixes for each diagnostic.
 *
 * VS Code's `Diagnostic` object has no place to stash structured fix
 * payloads, so we keep a parallel index keyed by document URI and looked
 * up by range from `provideCodeActions`. Updated on every check run.
 */
class FixesIndex {
  // Stable key per (uri, range) so range-equality lookups don't rely on
  // object identity (CodeAction passes back fresh Range instances).
  private byUri = new Map<string, Map<string, AwsumFix[]>>();

  set(uri: vscode.Uri, entries: { range: vscode.Range; fixes: AwsumFix[] }[]) {
    const inner = new Map<string, AwsumFix[]>();
    for (const { range, fixes } of entries) {
      if (fixes.length > 0) inner.set(rangeKey(range), fixes);
    }
    this.byUri.set(uri.toString(), inner);
  }

  get(uri: vscode.Uri, range: vscode.Range): AwsumFix[] {
    return this.byUri.get(uri.toString())?.get(rangeKey(range)) ?? [];
  }

  clear(uri: vscode.Uri) {
    this.byUri.delete(uri.toString());
  }
}

function rangeKey(r: vscode.Range): string {
  return `${r.start.line}:${r.start.character}-${r.end.line}:${r.end.character}`;
}

function awsumRangeToVsCode(r: AwsumRange): vscode.Range {
  return new vscode.Range(
    r.startLine - 1,
    r.startCol - 1,
    r.endLine - 1,
    r.endCol - 1
  );
}

function awsumSeverityToVsCode(s: AwsumDiagnostic["severity"]): vscode.DiagnosticSeverity {
  return s === "warning"
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
}

/**
 * Run `awsum check --json <file>`, parse JSON output, and update diagnostics
 * + the fixes index.
 *
 * The CLI writes a JSON array to stdout even on error (exit code 1).
 * On success it writes `[]`. We capture stdout regardless of exit code.
 */
async function runAwsumCheck(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  fixesIndex: FixesIndex
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const bin = (cfg.get<string>("awsum.format.path") || "awsum").trim();

  // Write the current (possibly unsaved) buffer to a temp file so we check
  // the latest content, not just what's on disk.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "awsum-check-"));
  const tmpPath = path.join(tmpDir, "check.aww");

  try {
    await fs.writeFile(tmpPath, document.getText(), "utf8");

    // `awsum check` now requires --program-type. Only `cli` exists today;
    // once awsum.json workspace config lands, this will come from there.
    const stdout = await execFileAsyncCapture(bin, [
      "check",
      "--json",
      "--program-type",
      "cli",
      tmpPath,
    ]);

    const items: AwsumDiagnostic[] = JSON.parse(stdout);
    const diags: vscode.Diagnostic[] = [];
    const fixEntries: { range: vscode.Range; fixes: AwsumFix[] }[] = [];
    for (const d of items) {
      const range = awsumRangeToVsCode(d);
      diags.push(new vscode.Diagnostic(range, d.message, awsumSeverityToVsCode(d.severity)));
      if (d.fixes && d.fixes.length > 0) {
        fixEntries.push({ range, fixes: d.fixes });
      }
    }

    collection.set(document.uri, diags);
    fixesIndex.set(document.uri, fixEntries);
  } catch {
    // Binary not found or other unexpected failure — clear stale diagnostics.
    collection.delete(document.uri);
    fixesIndex.clear(document.uri);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Surfaces compiler-supplied quick fixes (yellow lightbulb) for diagnostics
 * carrying a `fixes` payload. The fix titles and edit ranges come straight
 * from the CLI — the extension does no language-aware reasoning.
 */
class AwsumCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private fixesIndex: FixesIndex) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      const fixes = this.fixesIndex.get(document.uri, diag.range);
      for (const fix of fixes) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diag];
        const edit = new vscode.WorkspaceEdit();
        for (const e of fix.edits) {
          edit.replace(document.uri, awsumRangeToVsCode(e), e.newText);
        }
        action.edit = edit;
        actions.push(action);
      }
    }
    return actions;
  }
}

/**
 * Like `execFileAsync` but captures stdout even on non-zero exit.
 *
 * `awsum check --json` exits with code 1 on errors but still writes
 * valid JSON to stdout.  Node's `execFile` treats non-zero as an error,
 * so we pull stdout from the error object.
 */
function execFileAsyncCapture(
  file: string,
  args: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        // Non-zero exit: stdout is still populated in the error object.
        const out = stdout || (error as any).stdout || "";
        if (out) {
          resolve(out);
        } else {
          reject(error);
        }
      } else {
        resolve(stdout);
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Document Symbols (Outline)
// ────────────────────────────────────────────────────────────────────────────

/**
 * JSON shape returned by `awsum symbols --json`, mirroring the LSP
 * DocumentSymbol structure but with 1-based positions (matching Awsum's
 * diagnostic JSON convention).
 */
interface AwsumSymbol {
  kind: "function" | "constant" | "type";
  name: string;
  range: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  selectionRange: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  children: AwsumSymbol[];
}

class AwsumDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  async provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    const cfg = vscode.workspace.getConfiguration();
    const bin = (cfg.get<string>("awsum.format.path") || "awsum").trim();

    // Write current buffer to temp file so the CLI sees unsaved edits.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "awsum-symbols-"));
    const tmpPath = path.join(tmpDir, "symbols.aww");

    try {
      await fs.writeFile(tmpPath, document.getText(), "utf8");

      const { stdout } = await execFileAsync(
        bin,
        ["symbols", "--json", tmpPath],
        { token }
      );
      if (token.isCancellationRequested) return [];

      const items: AwsumSymbol[] = JSON.parse(stdout);
      return items.map(toVsCodeSymbol);
    } catch {
      // Parse/typecheck failure or missing binary → no outline this pass.
      return [];
    } finally {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function toVsCodeSymbol(s: AwsumSymbol): vscode.DocumentSymbol {
  const range = new vscode.Range(
    s.range.startLine - 1,
    s.range.startCol - 1,
    s.range.endLine - 1,
    s.range.endCol - 1
  );
  const selectionRange = new vscode.Range(
    s.selectionRange.startLine - 1,
    s.selectionRange.startCol - 1,
    s.selectionRange.endLine - 1,
    s.selectionRange.endCol - 1
  );
  const sym = new vscode.DocumentSymbol(
    s.name,
    "",
    mapKind(s.kind),
    range,
    selectionRange
  );
  sym.children = s.children.map(toVsCodeSymbol);
  return sym;
}

function mapKind(kind: AwsumSymbol["kind"]): vscode.SymbolKind {
  switch (kind) {
    case "function":
      return vscode.SymbolKind.Function;
    case "constant":
      return vscode.SymbolKind.Constant;
    case "type":
      return vscode.SymbolKind.Enum;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Workspace Symbols (Ctrl+T symbol search)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Indexes all `.aww` files in the workspace by calling `awsum symbols --json`
 * on each.  The index is built once at activation and updated incrementally
 * on file create / save / delete (via FileSystemWatcher + onDidSaveTextDocument).
 *
 * `provideWorkspaceSymbols` filters the cached index by substring match
 * (case-insensitive).  VS Code applies its own fuzzy ranking afterwards, so
 * an empty query returns everything.
 *
 * Notes:
 *  - Indexing is coarse: all files run concurrently; errors on individual
 *    files (e.g. parse failure) are swallowed so one broken file does not
 *    hide the rest of the workspace.
 *  - The cache is flat: hierarchical children from 'awsum symbols' are
 *    flattened via depth-first walk.  Children are currently empty in the
 *    CLI output but the walk future-proofs the handling.
 */
class AwsumWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
  private cache: { symbol: AwsumSymbol; uri: vscode.Uri }[] = [];
  private indexing: Promise<void> | null = null;

  async reindexAll(): Promise<void> {
    if (this.indexing) return this.indexing;
    this.indexing = this.doReindexAll();
    try {
      await this.indexing;
    } finally {
      this.indexing = null;
    }
  }

  private async doReindexAll(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      "**/*.aww",
      "**/{node_modules,.stack-work,.snapshots,dist-newstyle}/**"
    );
    const bin = getBinPath();
    const entries = await Promise.all(
      files.map(async (uri) => {
        const syms = await fetchSymbols(bin, uri.fsPath);
        return flattenSymbols(syms).map((symbol) => ({ symbol, uri }));
      })
    );
    this.cache = entries.flat();
  }

  async updateFile(uri: vscode.Uri): Promise<void> {
    const bin = getBinPath();
    // Remove existing entries for this file.
    const key = uri.toString();
    this.cache = this.cache.filter((e) => e.uri.toString() !== key);
    // Re-fetch and append.
    const syms = await fetchSymbols(bin, uri.fsPath);
    for (const s of flattenSymbols(syms)) {
      this.cache.push({ symbol: s, uri });
    }
  }

  removeFile(uri: vscode.Uri): void {
    const key = uri.toString();
    this.cache = this.cache.filter((e) => e.uri.toString() !== key);
  }

  async provideWorkspaceSymbols(
    query: string,
    _token: vscode.CancellationToken
  ): Promise<vscode.SymbolInformation[]> {
    // Wait for the initial index to finish so the first Ctrl+T after
    // activation returns real results instead of an empty list.
    if (this.indexing) await this.indexing;

    const q = query.toLowerCase();
    const result: vscode.SymbolInformation[] = [];
    for (const { symbol, uri } of this.cache) {
      if (q === "" || symbol.name.toLowerCase().includes(q)) {
        const range = new vscode.Range(
          symbol.range.startLine - 1,
          symbol.range.startCol - 1,
          symbol.range.endLine - 1,
          symbol.range.endCol - 1
        );
        result.push(
          new vscode.SymbolInformation(
            symbol.name,
            mapKind(symbol.kind),
            "", // container name: none for top-level decls
            new vscode.Location(uri, range)
          )
        );
      }
    }
    return result;
  }
}

/**
 * Read the configured awsum binary path (shared with formatter and check).
 */
function getBinPath(): string {
  const cfg = vscode.workspace.getConfiguration();
  return (cfg.get<string>("awsum.format.path") || "awsum").trim();
}

/**
 * Run `awsum symbols --json <file>` and parse the result.
 * Returns [] on any failure (missing binary, parse error, invalid JSON).
 */
async function fetchSymbols(
  bin: string,
  filePath: string
): Promise<AwsumSymbol[]> {
  try {
    const { stdout } = await execFileAsync(bin, ["symbols", "--json", filePath], {});
    return JSON.parse(stdout) as AwsumSymbol[];
  } catch {
    return [];
  }
}

/**
 * Depth-first walk that yields every symbol (including children) in
 * source order.  Children are currently empty in the CLI output but this
 * keeps the provider correct when constructor symbols are added later.
 */
function flattenSymbols(syms: AwsumSymbol[]): AwsumSymbol[] {
  const out: AwsumSymbol[] = [];
  const walk = (s: AwsumSymbol) => {
    out.push(s);
    for (const c of s.children) walk(c);
  };
  for (const s of syms) walk(s);
  return out;
}

/**
 * Extension deactivation hook (no-op for this extension).
 */
export function deactivate() {}
