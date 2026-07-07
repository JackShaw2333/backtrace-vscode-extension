/**
 * 底部堆栈面板（底部面板 → Backtrace Stack）。
 *
 * WebviewViewProvider 是 VSCode 提供 HTML 界面的方式。
 * 在这里渲染 root→当前节点的路径链，点击任意行可跳转。
 *
 * "collectPath() 从 currentNode 沿 parent 链收集，
 * 用 unshift 插入数组开头，最终得到从根到当前的正序数组。
 */

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

    /**
     * VSCode 调用此方法创建 / 恢复 WebviewView。
     * enableScripts = true 允许 HTML 中执行 JavaScript。
     * onDidReceiveMessage 处理来自 HTML 的消息。
     */
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
                    vscode.workspace.openTextDocument(uri).then(
                        (doc) => {
                            vscode.window.showTextDocument(doc, {
                                selection: new vscode.Range(node.line - 1, node.column - 1, node.line - 1, node.column - 1),
                            });
                        },
                        () => { vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`); },
                    );
                    vscode.commands.executeCommand('backtrace._treeChanged');
                }
            }
        });
    }

    /** 刷新面板内容 */
    update(): void {
        if (!this._view) return;
        const path = this.collectPath();
        this._view.webview.html = this.buildHtml(path);
    }

    /** 从 currentNode 沿 parent 向上收集，返回从根到当前的数组 */
    private collectPath(): NavNode[] {
        const path: NavNode[] = [];
        let node: NavNode | null = this.tree.currentNode;
        while (node) {
            path.unshift(node);
            node = node.parent;
        }
        return path;
    }

    /** 用简单哈希确保同一文件始终同色 */
    private getFileColor(uri: string): string {
        let hash = 0;
        for (let i = 0; i < uri.length; i++) {
            hash = (hash << 5) - hash + uri.charCodeAt(i);
        }
        return FILE_COLORS[Math.abs(hash) % FILE_COLORS.length];
    }

    /** 从完整路径中提取文件名 */
    private shortFileName(uri: string): string {
        return uri.split('/').pop() || uri.split('\\').pop() || uri;
    }

    /** HTML 转义，防止 XSS */
    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    /** 生成 HTML。每行显示颜色圆点 + 文件名:行号 + 符号名 */
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
/* var(--vscode-xxx) 是 VSCode 的 CSS 变量，自动适配亮/暗主题 */
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
    // acquireVsCodeApi() 是 VSCode 在 Webview 中注入的函数，用于和扩展通信
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.stack-row').forEach(row => {
        row.addEventListener('click', () => {
            vscode.postMessage({ command: 'jumpTo', index: parseInt(row.dataset.index) });
        });
    });
})();
</script>
</body>
</html>`;
    }
}
