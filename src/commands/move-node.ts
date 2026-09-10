/**
 * "上移 / 下调节点"命令（兄弟间排序）。
 *
 * 注册 backtrace.moveNodeUp / backtrace.moveNodeDown。
 * 在兄弟数组里和邻居换位，只改顺序不改父节点。
 * 顺序的意义：goForward 多分支 QuickPick 按 children 数组顺序列出，
 * 所以调序 = 调整前进选项的展示顺序。
 *
 * 注意：只有兄弟调序，没有跨父搬家——换父的拖拽功能已下线
 * （完整版留档在 backup/drag-attempt 分支），别在这里加"搬家"逻辑。
 *
 * 和 deleteNode.ts 同一模式：命令不在命令面板显示，
 * 通过底部面板的行内按钮触发（↑/↓，package.json 的 view/item/context
 * 的 inline 组，排在 jumpToCaller 左边；when 复用 viewItem != 'root'——
 * 根无兄弟可排）。行内按钮同时也会出现在右键菜单里，一举两得。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';

/** 注册"上移 / 下调"两条命令 */
export function registerMoveNode(context: vscode.ExtensionContext, tree: NavTree): void {
  const up = vscode.commands.registerCommand('backtrace.moveNodeUp', (node: NavNode) => {
    if (!node) return;
    // moveSibling 返回 false = 已在最上（或根，无兄弟）→ 轻提示，不 fire。
    if (!tree.moveSibling(node, -1)) {
      vscode.window.setStatusBarMessage('$(arrow-up) Backtrace: Already at the top', 2000);
      return;
    }
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  const down = vscode.commands.registerCommand('backtrace.moveNodeDown', (node: NavNode) => {
    if (!node) return;
    if (!tree.moveSibling(node, 1)) {
      vscode.window.setStatusBarMessage('$(arrow-down) Backtrace: Already at the bottom', 2000);
      return;
    }
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  context.subscriptions.push(up, down);
}
