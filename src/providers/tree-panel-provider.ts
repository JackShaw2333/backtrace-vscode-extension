/**
 * 底部树视图面板（底部 Panel → "Backtrace Tree"）。
 *
 * 显示整个导航树的完整结构，每行一个节点，带缩进表示层级。
 * 格式：filename:line  functionPath  ×删除
 *
 * 为什么用 Webview 而不是 TreeView？
 *   需要自定义布局（日志风格的行格式 + 删除按钮），
 *   TreeView 不支持自定义内容。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';

export class BacktraceTreePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'backtraceStack';
  private _view?: vscode.WebviewView;

  constructor(private tree: NavTree) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.update();

    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.command === 'jumpTo' && message.indices !== undefined) {
        const node = this.findNodeAtIndex(this.tree.root, message.indices);
        if (node) {
          this.tree.currentNode = node;
          const uri = vscode.Uri.parse(node.uri);
          vscode.workspace.openTextDocument(uri).then(
            (doc) => vscode.window.showTextDocument(doc, {
              selection: new vscode.Range(node.line - 1, node.column - 1, node.line - 1, node.column - 1),
            }),
            () => vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`),
          );
          vscode.commands.executeCommand('backtrace._treeChanged');
        }
      }
      if (message.command === 'deleteNode' && message.indices !== undefined) {
        const node = this.findNodeAtIndex(this.tree.root, message.indices);
        if (node) {
          this.tree.removeNode(node);
          vscode.commands.executeCommand('backtrace._treeChanged');
        }
      }
    });
  }

  update(): void {
    if (!this._view) return;
    this._view.webview.html = this.buildHtml();
  }

  /** 递归查找节点：按索引路径定位 */
  private findNodeAtIndex(node: NavNode | null, indices: number[]): NavNode | null {
    let current = node;
    for (const i of indices) {
      if (!current || i >= current.children.length) return null;
      current = current.children[i];
    }
    return current;
  }

  private getFileColor(uri: string): string {
    let hash = 0;
    for (let i = 0; i < uri.length; i++) hash = (hash << 5) - hash + uri.charCodeAt(i);
    return FILE_COLORS[Math.abs(hash) % FILE_COLORS.length];
  }

  private shortFileName(uri: string): string {
    return uri.split('/').pop() || uri.split('\\').pop() || uri;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /** 递归生成 HTML 行 */
  private renderNode(node: NavNode, depth: number, indices: number[]): string {
    const color = this.getFileColor(node.uri);
    const fileName = this.shortFileName(node.uri);
    const display = node.contextName || node.symbolName || '(root)';
    const isCurrent = node === this.tree.currentNode;
    const indent = depth * 20;
    const idxAttr = JSON.stringify(indices);

    let html = `
      <div class="stack-row ${isCurrent ? 'current' : ''}" style="padding-left:${indent + 8}px" data-idx='${idxAttr}'>
        <span class="delete-btn" data-action="delete">&times;</span>
        <span class="file-color" style="background:${color}"></span>
        <span class="file-loc">${this.escapeHtml(fileName)}:${node.line}</span>
        <span class="func-path">${this.escapeHtml(display)}</span>
        <span class="spacer"></span>
        ${isCurrent ? '<span class="badge">\u2190</span>' : ''}
      </div>`;

    // 递归渲染子节点
    for (let i = 0; i < node.children.length; i++) {
      html += this.renderNode(node.children[i], depth + 1, [...indices, i]);
    }

    return html;
  }

  private buildHtml(): string {
    const treeHtml = this.tree.root ? this.renderNode(this.tree.root, 0, []) : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<style>
body { font-family: var(--vscode-font-family); font-size: 13px; padding: 4px 0; margin: 0; }
.stack-row { display: flex; align-items: center; gap: 5px; padding: 3px 8px; cursor: pointer; border-radius: 2px; }
.stack-row:hover { background: var(--vscode-list-hoverBackground); }
.stack-row.current { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.file-color { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.file-loc { color: var(--vscode-textPreformat-foreground); white-space: nowrap; }
.func-path { font-weight: 500; white-space: nowrap; }
.spacer { flex: 1; }
.badge { font-weight: bold; font-size: 12px; }
.delete-btn { visibility: hidden; cursor: pointer; font-size: 12px; opacity: 0.6; }
.delete-btn:hover { opacity: 1; }
.stack-row:hover .delete-btn { visibility: visible; }
.empty { color: var(--vscode-disabledForeground); padding: 16px; text-align: center; }
</style>
</head>
<body>
${treeHtml || '<div class="empty">No navigation history</div>'}
<script>
(function() {
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('.stack-row').forEach(row => {
    const idx = JSON.parse(row.dataset.idx);
    // 点击行 = 跳转
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-btn')) return;
      vscode.postMessage({ command: 'jumpTo', indices: idx });
    });
    // 点击删除按钮
    const delBtn = row.querySelector('.delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: 'deleteNode', indices: idx });
      });
    }
  });
})();
</script>
</body>
</html>`;
  }
}
