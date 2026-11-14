/**
 * `awsum-vscode` — thin LSP client to `awsum lsp`.
 *
 * Every editor feature — diagnostics, code actions, formatting, hover,
 * document symbols, workspace symbols — is delivered by the `awsum lsp`
 * server (a subcommand of the `awsum` compiler binary). This file is
 * the minimum shim VS Code needs: locate the binary, spawn it, hand
 * stdio to the standard `vscode-languageclient` machinery, register it
 * as the language client for `.aww` files. Everything else lives in
 * `awsum/src/Awsum/Lsp.hs` on the compiler side
 * (https://github.com/awsum-lang/awsum).
 *
 * What lives here, not on the server:
 *   - TextMate grammar (`syntaxes/awsum.tmLanguage.json`) — VS Code's
 *     highlighting source. Tree-sitter is a Zed-only path.
 *   - `language-configuration.json` — comments, brackets, auto-close.
 *   - The `awsum.path` setting — points at the binary that the
 *     extension spawns as `awsum lsp --stdio`.
 *   - Lockstep version declaration — pass `expectedAwsumVersion` in
 *     `initializationOptions`. The server compares against its own
 *     version and pushes a `window/showMessage` warning on mismatch
 *     (same code path runs for any LSP client that opts in: Zed,
 *     Helix, …). Lockstep `awsum-vscode A.B.C` ↔ `awsum A.B.C`.
 */

import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const extensionVersion: string = context.extension.packageJSON.version;
  client = createClient(awsumPath(), extensionVersion);

  // A client keeps the server options it was created with, so a new path
  // takes a new client. It starts only if the old one was running: before
  // the first `.aww` file the server is not wanted yet.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration("awsum.path") || !client) return;
      const wasRunning = client.isRunning();
      await client.dispose();
      client = createClient(awsumPath(), extensionVersion);
      if (wasRunning) await safeStart(client, awsumPath());
    }),
  );

  // User-facing "Awsum: Restart Awsum LSP server" command. Useful after a
  // local `stack install` of a new `awsum` build, or any time the server's
  // in-memory state needs a clean slate.
  context.subscriptions.push(
    vscode.commands.registerCommand("awsum.restartLspServer", async () => {
      if (!client) return;
      await client.restart();
      vscode.window.showInformationMessage("Awsum LSP server restarted.");
    }),
  );

  // VS Code activates the extension for `.awsum` files too, so the server
  // starts with the first `.aww` file: a session without one never needs
  // the `awsum` binary.
  const isAww = (document: vscode.TextDocument) => document.languageId === "awsum-haskell";
  if (vscode.workspace.textDocuments.some(isAww)) {
    await safeStart(client, awsumPath());
    return;
  }
  const opened = vscode.workspace.onDidOpenTextDocument(async (document) => {
    if (!isAww(document) || !client) return;
    opened.dispose();
    await safeStart(client, awsumPath());
  });
  context.subscriptions.push(opened);
}

function awsumPath(): string {
  return (vscode.workspace.getConfiguration().get<string>("awsum.path") || "awsum").trim();
}

function createClient(bin: string, extensionVersion: string): LanguageClient {
  // `serverOptions` describes how the language client should spawn the
  // server. We launch the configured `awsum` binary with the `lsp`
  // subcommand; `vscode-languageclient` adds `--stdio` to args because
  // of the explicit `transport` field, and our server requires it (see
  // the `awsum lsp --stdio` contract in the compiler's `Awsum.Cli`).
  // No defaulting on transport — both sides name it explicitly.
  const serverOptions: ServerOptions = {
    command: bin,
    args: ["lsp"],
    transport: TransportKind.stdio,
  };

  // `clientOptions` tells the language client which documents the
  // server should see plus the cross-handshake initialization payload.
  const clientOptions: LanguageClientOptions = {
    // Only `.aww` files, the language of the Haskell implementation that
    // serves `awsum lsp`. `.awsum` files join once the self-hosted `awsum`
    // CLI has a language server; until then they get highlighting alone.
    documentSelector: [{ scheme: "file", language: "awsum-haskell" }],
    // Keep the diagnostic source identifier in sync with what the
    // server uses (see Awsum.Lsp `_source = Just "awsum"`), so the
    // VS Code Problems panel groups diagnostics under one entry per
    // language rather than one per file.
    diagnosticCollectionName: "awsum",
    // Hints the server reads from `initialize.params.initializationOptions`:
    //
    //   - `expectedAwsumVersion`: the server compares with its own
    //     (compiler) version and warns on mismatch.
    //   - `preferButtonsOverLinks: true`: VS Code does not auto-linkify
    //     URLs in notifications, but reliably routes
    //     `window/showDocument` to `vscode.env.openExternal`. Tell the
    //     server to use a `window/showMessageRequest` action button
    //     instead of inlining the URL — clicking opens the page.
    initializationOptions: {
      expectedAwsumVersion: extensionVersion,
      preferButtonsOverLinks: true,
    },
  };

  return new LanguageClient("awsum", "Awsum LSP", serverOptions, clientOptions);
}

/**
 * Wrap `client.start()` so that a binary-not-found / spawn error surfaces
 * as a user-visible notification instead of a silent activation failure.
 *
 * Without this, "no formatter for awsum files" is the only feedback the
 * user sees — and they have to dig into the Developer Console to discover
 * it's actually a PATH problem (very common when VS Code is launched from
 * Finder on macOS, since GUI launches don't inherit the shell PATH where
 * `~/.local/bin` typically lives).
 */
async function safeStart(c: LanguageClient, bin: string): Promise<void> {
  try {
    await c.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `awsum LSP server failed to start (${msg}). ` +
        `Make sure '${bin}' is on the PATH that VS Code sees, or set ` +
        `'awsum.path' to the absolute path of the awsum binary ` +
        `(e.g. '/Users/you/.local/bin/awsum').`,
    );
  }
}

export async function deactivate(): Promise<void> {
  if (!client) return;
  await client.stop();
  client = undefined;
}
