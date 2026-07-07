import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';

interface PendingCapture {
    fromUri: string;
    fromLine: number;
    fromColumn: number;
    symbolName: string;
    timer: NodeJS.Timeout;
}

export class CommandWatcher {
    private disposable: vscode.Disposable | null = null;
    private pending: PendingCapture | null = null;
    private config!: BacktraceConfig;

    constructor(private tree: NavTree) {}

    /** Start listening for commands */
    activate(config: BacktraceConfig, context: vscode.ExtensionContext): void {
        this.config = config;
        const commandSet = new Set(config.trackedCommands);

        this.disposable = vscode.commands.onDidExecuteCommand((event) => {
            if (!commandSet.has(event.command)) return;

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const position = editor.selection.active;
            const document = editor.document;
            const wordRange = document.getWordRangeAtPosition(position);
            const word = wordRange ? document.getText(wordRange) : '';

            const uri = document.uri.toString();
            const line = position.line + 1;
            const column = position.character + 1;

            // Clear previous pending capture
            if (this.pending) {
                clearTimeout(this.pending.timer);
            }

            // Set new pending capture with debounce
            const timer = setTimeout(() => {
                this.finalizeCapture(uri, line, column, word);
            }, CURSOR_STABILIZE_DELAY_MS);

            this.pending = {
                fromUri: uri,
                fromLine: line,
                fromColumn: column,
                symbolName: word,
                timer,
            };
        });

        if (this.disposable) {
            context.subscriptions.push(this.disposable);
        }
    }

    /** Stop listening */
    deactivate(): void {
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending = null;
        }
        this.disposable?.dispose();
        this.disposable = null;
    }

    private finalizeCapture(fromUri: string, fromLine: number, fromColumn: number, symbolName: string): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const toUri = editor.document.uri.toString();
        const toLine = position.line + 1;
        const toColumn = position.character + 1;

        // Same position — no real jump happened
        if (toUri === fromUri && toLine === fromLine && toColumn === fromColumn) return;

        this.tree.addJump(toUri, toLine, toColumn, symbolName);

        // Fire event so providers refresh
        vscode.commands.executeCommand('backtrace._treeChanged');
    }
}
