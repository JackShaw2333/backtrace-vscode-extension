import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';

export class BacktraceStackProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'backtraceStack';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private tree: NavTree,
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this.update();

        webviewView.webview.onDidReceiveMessage((message) => {
            if (message.command === 'jumpTo') {
                const path = this.collectPath();
                const node = path[message.index];
                if (node) {
                    this.tree.currentNode = node;
                    const uri = vscode.Uri.parse(node.uri);
                    vscode.workspace.openTextDocument(uri).then((doc) => {
                        vscode.window.showTextDocument(doc, {
                            selection: new vscode.Range(
                                node.line - 1, node.column - 1,
                                node.line - 1, node.column - 1
                            ),
                        });
                    });
                    vscode.commands.executeCommand('backtrace._treeChanged');
                }
            }
        });
    }

    /** Refresh the webview content */
    update(): void {
        if (!this._view) return;
        const path = this.collectPath();
        const html = this.buildHtml(path);
        this._view.webview.html = html;
    }

    private collectPath(): NavNode[] {
        const path: NavNode[] = [];
        let node: NavNode | null = this.tree.currentNode;
        while (node) {
            path.unshift(node);
            node = node.parent;
        }
        return path;
    }

    private getFileColor(uri: string): string {
        let hash = 0;
        for (let i = 0; i < uri.length; i++) {
            hash = ((hash << 5) - hash) + uri.charCodeAt(i);
        }
        return FILE_COLORS[Math.abs(hash) % FILE_COLORS.length];
    }

    private shortFileName(uri: string): string {
        return uri.split('/').pop() || uri.split('\\').pop() || uri;
    }

    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    private buildHtml(path: NavNode[]): string {
        const rows = path.map((node, index) => {
            const color = this.getFileColor(node.uri);
            const fileName = this.shortFileName(node.uri);
            const isCurrent = index === path.length - 1;
            return `
                <div class="stack-row ${isCurrent ? 'current' : ''}" data-index="${index}">
                    <span class="file-color" style="background:${color}"></span>
                    <span class="file-name">${this.escapeHtml(fileName)}</span>
                    <span class="line-num">:${node.line}</span>
                    <span class="symbol-name">${this.escapeHtml(node.symbolName || '')}</span>
                    ${isCurrent ? '<span class="badge">←</span>' : ''}
                </div>`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<style>
body { font-family: var(--vscode-font-family); font-size: 13px; padding: 8px; margin: 0; }
.stack-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; border-radius: 3px; }
.stack-row:hover { background: var(--vscode-list-hoverBackground); }
.stack-row.current { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.file-color { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.file-name { font-weight: 600; }
.line-num { color: var(--vscode-textPreformat-foreground); }
.symbol-name { color: var(--vscode-textLink-foreground); margin-left: auto; }
.badge { font-weight: bold; }
.empty { color: var(--vscode-disabledForeground); padding: 16px; text-align: center; }
</style>
</head>
<body>
${path.length === 0 ? '<div class="empty">No navigation history</div>' : rows}
<script>
(function() {
    const rows = document.querySelectorAll('.stack-row');
    rows.forEach(row => {
        row.addEventListener('click', () => {
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'jumpTo', index: parseInt(row.dataset.index) });
        });
    });
})();
</script>
</body>
</html>`;
    }
}
