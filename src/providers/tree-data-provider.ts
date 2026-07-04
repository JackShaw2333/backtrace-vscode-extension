import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';
import { navigateToNode } from '../commands/go-back';

export class BacktraceTreeProvider implements vscode.TreeDataProvider<NavNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NavNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private tree: NavTree) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: NavNode): vscode.TreeItem {
        const isCurrent = element === this.tree.currentNode;
        const item = new vscode.TreeItem(element.symbolName || '(root)');
        item.description = `${this.shortFileName(element.uri)}:${element.line}`;

        const colorIndex = this.getFileColorIndex(element.uri);
        (item as any).color = FILE_COLORS[colorIndex % FILE_COLORS.length];
        item.iconPath = isCurrent
            ? new vscode.ThemeIcon('arrow-right')
            : new vscode.ThemeIcon('symbol-method');

        item.command = {
            command: 'backtrace._jumpToNode',
            title: 'Jump to location',
            arguments: [element],
        };

        item.contextValue = isCurrent ? 'currentNode' : 'node';
        return item;
    }

    getChildren(element?: NavNode): NavNode[] {
        if (!this.tree.root) return [];
        if (!element) return [this.tree.root];
        return element.children;
    }

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

/** Register the _jumpToNode internal command */
export function registerJumpCommand(context: vscode.ExtensionContext, tree: NavTree): void {
    const disposable = vscode.commands.registerCommand('backtrace._jumpToNode', (node: NavNode) => {
        if (!node) return;
        tree.currentNode = node;
        navigateToNode(node);
        vscode.commands.executeCommand('backtrace._treeChanged');
    });
    context.subscriptions.push(disposable);
}
