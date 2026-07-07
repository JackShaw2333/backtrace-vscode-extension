/**
 * 底部堆栈面板（底部面板 → "Backtrace Stack"）。
 *
 * 显示从树根到当前位置的完整路径，每行一个节点。
 * 点击任意行可以跳转到对应位置。
 *
 * WebviewViewProvider 是 VSCode 提供 HTML 界面的接口。
 * 为什么用 HTML 而不是直接用 TreeDataProvider？
 *   因为堆栈面板需要显示"路径"（从根到当前的线性链），
 *   不是完整的树结构。用 HTML 可以更灵活地控制布局。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';

export class BacktraceStackProvider implements vscode.WebviewViewProvider {
    /**
     * viewType（视图类型标识符）：
     *   为什么是 static + readonly？这个值在类实例化之前就需要被引用
     *   （在 extension.ts 中注册时使用）。
     *   必须和 package.json 中 contributes.views 注册的 ID 一致。
     */
    public static readonly viewType = 'backtraceStack';

    /**
     * _view（WebviewView 实例的引用）：
     *   为什么需要保存？update() 方法需要向 WebviewView 写入 HTML，
     *   但 VSCode 在 resolveWebviewView 时才提供这个实例。
     *   所以先存下来，update() 时直接用。
     *   为什么可能为 undefined？面板还没有被打开过的时候。
     */
    private _view?: vscode.WebviewView;

    /**
     * @param extensionUri 扩展所在目录的 URI。
     *   为什么需要？如果以后要加载 CSS/JS 资源文件，需要通过这个 URI 定位。
     *   readonly 表示初始化后不能修改。
     * @param tree 共享的导航树实例。
     *   为什么存 tree？collectPath() 需要从 currentNode 反向收集路径。
     */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private tree: NavTree,
    ) {}

    /**
     * VSCode 调用此方法创建/恢复 WebviewView。
     * 每次面板显示时都会调用，但内容可能是恢复的。
     *
     * enableScripts = true：允许 HTML 中的 JavaScript 执行。
     * 为什么需要脚本？用户点击行时需要向扩展发送消息（postMessage）。
     */
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this.update();

        // 接收来自 HTML 的消息（用户点击某行时触发）
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

    /** 刷新面板内容：重新收集路径，生成新 HTML，替换旧内容 */
    update(): void {
        if (!this._view) return;
        const path = this.collectPath();
        this._view.webview.html = this.buildHtml(path);
    }

    /**
     * 从 currentNode 开始，沿 parent 链走到树根。
     * 用 unshift 把节点插入数组开头，最终得到从根到当前节点的正序数组。
     *
     * 为什么用 unshift 而不是 push？
     *   收集顺序为：currentNode → parent → root，
     *   但显示顺序应为：root → ... → currentNode。
     *   unshift 每次插入到数组开头，自动得到正序。
     */
    private collectPath(): NavNode[] {
        const path: NavNode[] = [];
        let node: NavNode | null = this.tree.currentNode;
        while (node) {
            path.unshift(node);
            node = node.parent;
        }
        return path;
    }

    /**
     * 根据文件路径生成稳定的颜色。
     * 用简单的字符串哈希算法确保同一文件始终同色。
     * 为什么不直接用 TreeView 的颜色分配？
     *   因为 Webview 不共享 TreeView 的上下文，需要自己计算。
     */
    private getFileColor(uri: string): string {
        let hash = 0;
        for (let i = 0; i < uri.length; i++) {
            hash = (hash << 5) - hash + uri.charCodeAt(i);
        }
        return FILE_COLORS[Math.abs(hash) % FILE_COLORS.length];
    }

    /** 从完整 URI 路径中提取文件名 */
    private shortFileName(uri: string): string {
        return uri.split('/').pop() || uri.split('\\').pop() || uri;
    }

    /**
     * HTML 转义。
     * 为什么需要？文件名可能包含 < > & " ' 等特殊字符，
     * 直接嵌入 HTML 会导致解析错误或 XSS 攻击。
     * 这是安全编码的基本原则：永远不要信任用户数据。
     */
    private escapeHtml(text: string): string {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    /**
     * 生成面板的 HTML。
     * 每行包含：颜色圆点 + 文件名:行号 + 符号名 + 当前标记
     */
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
    // acquireVsCodeApi() 是 VSCode 在 Webview 中注入的函数
    // 没有它，HTML 就无法和扩展主进程通信
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.stack-row').forEach(row => {
        row.addEventListener('click', () => {
            // postMessage 向扩展发送消息
            vscode.postMessage({ command: 'jumpTo', index: parseInt(row.dataset.index) });
        });
    });
})();
</script>
</body>
</html>`;
    }
}
