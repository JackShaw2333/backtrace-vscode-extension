/**
 * 侧边栏树视图（Explorer 中的 Backtrace Tree）。
 *
 * TreeDataProvider 是 VSCode 的标准接口，作用是"把一个数据对象
 * 转成可视化的树节点"。
 * - getTreeItem()：节点 → 显示样式
 * - getChildren()：获取子节点
 * - getParent()：获取父节点
 * - onDidChangeTreeData：通知 VSCode 刷新视觉
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';
import { navigateToNode } from '../commands/go-back';

/** TreeDataProvider<NavNode> 的泛型 <NavNode> 表示树中每个节点的数据类型 */
export class BacktraceTreeProvider implements vscode.TreeDataProvider<NavNode> {
    // EventEmitter 发射事件，VSCode 收到后刷新树视图
    private _onDidChangeTreeData = new vscode.EventEmitter<NavNode | undefined>();
    // getter 语法：像属性一样访问，背后执行的是函数
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private tree: NavTree) {}

    /** 通知 VSCode 刷新树视图（fire(undefined) = 整个树都可能变了） */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /** 把数据节点转成 VSCode 树能显示的项目 */
    getTreeItem(element: NavNode): vscode.TreeItem {
        const isCurrent = element === this.tree.currentNode; // 检查是否当前节点
        const item = new vscode.TreeItem(element.symbolName || '(root)');
        item.description = `${this.shortFileName(element.uri)}:${element.line}`;

        // TreeItem.color 不是公开 API，用 (item as any) 跳过类型检查
        const colorIndex = this.getFileColorIndex(element.uri);
        (item as any).color = FILE_COLORS[colorIndex % FILE_COLORS.length];

        // 当前节点用箭头图标，其他用函数图标
        item.iconPath = isCurrent
            ? new vscode.ThemeIcon('arrow-right')
            : new vscode.ThemeIcon('symbol-method');

        // 点击节点时执行的命令
        item.command = {
            command: 'backtrace._jumpToNode',
            title: 'Jump to location',
            arguments: [element],
        };

        item.contextValue = isCurrent ? 'currentNode' : 'node';
        return item;
    }

    /** 获取子节点。element 为空时返回根节点 */
    getChildren(element?: NavNode): NavNode[] {
        if (!this.tree.root) return [];
        if (!element) return [this.tree.root];
        return element.children;
    }

    /** 获取父节点（用于"在树中定位"功能） */
    getParent(element: NavNode): NavNode | null {
        return element.parent;
    }

    /** 从 URI 中提取文件名 */
    private shortFileName(uri: string): string {
        return uri.split('/').pop() || uri.split('\\').pop() || uri;
    }

    /** 文件 → 颜色索引 映射表（同一文件始终同一颜色） */
    private fileColorMap = new Map<string, number>();
    private nextColorIndex = 0;

    private getFileColorIndex(uri: string): number {
        if (!this.fileColorMap.has(uri)) {
            this.fileColorMap.set(uri, this.nextColorIndex++);
        }
        return this.fileColorMap.get(uri)!;
    }
}

/** 注册内部命令 _jumpToNode（用户点击树节点时执行） */
export function registerJumpCommand(context: vscode.ExtensionContext, tree: NavTree): void {
    const disposable = vscode.commands.registerCommand('backtrace._jumpToNode', (node: NavNode) => {
        if (!node) return;
        tree.currentNode = node;
        navigateToNode(node);
        vscode.commands.executeCommand('backtrace._treeChanged');
    });
    context.subscriptions.push(disposable);
}
