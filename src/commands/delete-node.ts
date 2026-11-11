/**
 * "删除节点"命令。
 *
 * 注册 backtrace.deleteNode 命令。
 * 从导航树中删除一个节点及其所有子节点，并刷新 UI。
 * 这个命令不在命令面板显示（"hidden": true），只能通过右键菜单触发。
 *
 * 多根森林下，删除根 = 删除整棵树：这是破坏性最大的操作，
 * 所以对根节点额外弹一次模态确认；普通分支维持原行为（无确认）。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';

/** 注册删除节点命令 */
export function registerDeleteNode(context: vscode.ExtensionContext, tree: NavTree): void {
  const disposable = vscode.commands.registerCommand('backtrace.deleteNode', async (node: NavNode) => {
    if (!node) return;
    if (!node.parent) {
      // 删除根会连同整棵子树一起消失，不可撤销——二次确认。
      const label = node.label || node.contextName || node.symbolName || 'this root';
      const confirmed = await vscode.window.showWarningMessage(
        `Delete root "${label}" and its whole tree?`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') {
        return;
      }
    }
    tree.removeNode(node);
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  context.subscriptions.push(disposable);
}
