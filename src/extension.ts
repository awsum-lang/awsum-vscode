/**
 * Awsum VS Code Extension – Formatting + Diagnostics
 *
 * Responsibilities:
 *  - Register a DocumentFormattingEditProvider for the Awsum language.
 *  - Invoke the external `awsum` CLI formatter safely and predictably.
 *  - Preserve the document's end-of-line style (LF/CRLF).
 *  - Preserve the "final newline" semantics of the original buffer:
 *      * if the original ended with a newline → leave exactly one;
 *      * otherwise → remove trailing newlines.
 *  - Run `awsum check --json` on open/save/change to provide inline diagnostics.
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

  // Diagnostics provider.
  const diagnostics = vscode.languages.createDiagnosticCollection("awsum");
  context.subscriptions.push(diagnostics);

  const checkDocument = (doc: vscode.TextDocument) => {
    if (doc.languageId === "awsum" && doc.uri.scheme === "file") {
      runAwsumCheck(doc, diagnostics);
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
 *   [{ startLine, startCol, endLine, endCol, message }]
 *
 * Positions are 1-based; VS Code expects 0-based.
 */
interface AwsumDiagnostic {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  message: string;
}

/**
 * Run `awsum check --json <file>`, parse JSON output, and update diagnostics.
 *
 * The CLI writes a JSON array to stdout even on error (exit code 1).
 * On success it writes `[]`.  We capture stdout regardless of exit code.
 */
async function runAwsumCheck(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const bin = (cfg.get<string>("awsum.format.path") || "awsum").trim();

  // Write the current (possibly unsaved) buffer to a temp file so we check
  // the latest content, not just what's on disk.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "awsum-check-"));
  const tmpPath = path.join(tmpDir, "check.aww");

  try {
    await fs.writeFile(tmpPath, document.getText(), "utf8");

    const stdout = await execFileAsyncCapture(bin, [
      "check",
      "--json",
      tmpPath,
    ]);

    const items: AwsumDiagnostic[] = JSON.parse(stdout);
    const diags: vscode.Diagnostic[] = items.map((d) => {
      const range = new vscode.Range(
        d.startLine - 1,
        d.startCol - 1,
        d.endLine - 1,
        d.endCol - 1
      );
      return new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Error);
    });

    collection.set(document.uri, diags);
  } catch {
    // Binary not found or other unexpected failure — clear stale diagnostics.
    collection.delete(document.uri);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
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

/**
 * Extension deactivation hook (no-op for this extension).
 */
export function deactivate() {}
