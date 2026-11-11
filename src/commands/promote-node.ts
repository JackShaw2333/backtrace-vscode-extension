/**
 * “提升为根”命令。
 *
 * 把面板里选中的节点及其整棵子树从原父链摘下，单独成为一棵新树。
 *
 * 为什么需要它？
 *   探索到一半才发现“这次链的起点选错了”是常见场景：
 *   先随手 F12 了几层，才意识到应该从某个 controller 方法开始。
 *   有了它，就能把当前这段探索整体摘出来当根，不必重走一遍。
 *
 * 与“光标处建根”的分工：
 *   - 建根：新起一条链（光标位置 = 新根）；
 *   - 提升：把已有的一段链（节点 + 下游子树）重新锚定成根。
 *
 * 为什么不做“换父到任意节点”？
 *   节点树的 parent 记录“我当时从哪跳过来”，人为改父等于伪造调用路径，
 *   是伪需求；唯一需要的结构调整就是“摘出来单独成根”。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';

/** 注册 backtrace.promoteNodeToRoot 命令 */
export function registerPromoteNode(context: vscode.ExtensionContext, tree: NavTree): void {
  const disposable = vscode.commands.registerCommand('backtrace.promoteNodeToRoot', (node: NavNode) => {
    if (!node) {
      return;
    }
    if (!tree.promoteToRoot(node)) {
      vscode.window.setStatusBarMessage('$(warning) Backtrace: this node is already a root', 2500);
      return;
    }
    vscode.commands.executeCommand('backtrace._treeChanged');
    vscode.window.setStatusBarMessage(
      `$(home) Backtrace: promoted to root — ${node.label || node.contextName || node.symbolName || 'node'}`,
      3000,
    );
  });
  context.subscriptions.push(disposable);
}
