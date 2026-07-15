/**
 * "删除节点"命令。
 *
 * 注册 backtrace.deleteNode 命令。
 * 从导航树中删除一个节点及其所有子节点，并刷新 UI。
 * 这个命令不在命令面板显示（"hidden": true），只能通过右键菜单触发。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';

/** 注册删除节点命令 */
export function registerDeleteNode(context: vscode.ExtensionContext, tree: NavTree): void {
  const disposable = vscode.commands.registerCommand(
    'backtrace.deleteNode',
    (node: NavNode) => {
      if (!node) return;
      tree.removeNode(node);
      vscode.commands.executeCommand('backtrace._treeChanged');
    },
  );
  context.subscriptions.push(disposable);
}
