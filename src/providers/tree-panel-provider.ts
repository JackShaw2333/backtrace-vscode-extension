/**
 * 底部树视图面板（Panel → "Backtrace Tree"）。
 *
 * 作为 TreeDataProvider 显示导航树的完整结构。
 * 区别于侧边栏路径视图（只显示单一路径），
 * 底部面板展开所有分支，完整展示导航树的全局结构。
 *
 * 删除操作通过右键菜单上下文（view/item/context）触发。
 */
import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';
import { navigateToNode } from '../commands/navigate';

export class BacktraceTreePanelProvider implements vscode.TreeDataProvider<NavNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NavNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private tree: NavTree) {}

  refresh(): void {
    console.log('[Backtrace] TreeView refresh fired');
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: NavNode): vscode.TreeItem {
    const isCurrent = element === this.tree.currentNode;
    const display = element.contextName || element.symbolName || '(root)';
    const fileName = this.shortFileName(element.uri);

    // 使用 format 显示 "fileName:line   symbolName"
    const item = new vscode.TreeItem({
      label: display,
      highlights: undefined,
    });

    // description 显示文件名:行号（灰色次要文字）
    item.description = `${fileName}:${element.line}`;

    // 文件颜色
    const colorIndex = this.getFileColorIndex(element.uri);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item as any).color = FILE_COLORS[colorIndex % FILE_COLORS.length];

    // 图标：当前节点用箭头，其他用函数图标
    item.iconPath = isCurrent
      ? new vscode.ThemeIcon('arrow-right')
      : new vscode.ThemeIcon('symbol-method');

    // 点击跳转
    item.command = {
      command: 'backtrace._jumpToNode',
      title: 'Jump to location',
      arguments: [element],
    };

    // contextValue：用于右键菜单的 when 条件
    item.contextValue = element === this.tree.currentNode ? 'currentNode' : 'node';
    if (element === this.tree.root) item.contextValue = 'root';

    // collapsibleState：告诉 VSCode 哪些节点可展开。
    // 没有设置这个属性的节点不会显示展开箭头，
    // VSCode 也不会为它们调用 getChildren → 子节点不可见。
    // Expanded：默认展开（底部面板目标：一眼看到完整树）
    item.collapsibleState = element.children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;

    return item;
  }

  /** 获取子节点。底部面板展示全部子节点（完整树） */
  getChildren(element?: NavNode): NavNode[] {
    if (!this.tree.root) return [];
    if (!element) {
      console.log('[Backtrace] TreeView getChildren() → root');
      return [this.tree.root];
    }
    console.log(`[Backtrace] TreeView getChildren(${element.symbolName || 'root'}) → ${element.children.length} children`);
    return element.children;
  }

  /** 获取父节点 */
  getParent(element: NavNode): NavNode | null {
    return element.parent;
  }

  private shortFileName(uri: string): string {
    return uri.split('/').pop() || uri.split('\\').pop() || uri;
  }

  private fileColorMap = new Map<string, number>();
  private nextColorIndex = 0;

  private getFileColorIndex(uri: string): number {
    if (!this.fileColorMap.has(uri)) {
      this.fileColorMap.set(uri, this.nextColorIndex++);
    }
    return this.fileColorMap.get(uri)!;
  }
}
