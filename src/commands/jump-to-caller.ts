/**
 * "跳转到调用位置"命令。
 *
 * 注册 backtrace.jumpToCaller 命令。
 *
 * 与 backtrace._jumpToNode（跳到该节点自身位置）不同：
 *   - _jumpToNode 跳到节点记录的目标位置（node.uri / node.line）
 *   - jumpToCaller 跳到"父节点函数中触发 F12 的那一行"（node.callerUri / node.callerLine）
 *
 * 为什么需要这个命令？
 *   父节点只记录了"跳转到的目标位置"（如函数定义处），
 *   但实际触发 F12 的位置可能在父函数体的任意一行。
 *   保存 callerPosition 后，新按钮可以精确回到调用点，
 *   而不是父函数的初始位置。
 *
 * 命令不在命令面板显示（"hidden": true），只通过树视图的内联按钮触发。
 * 旧数据节点没有 callerUri → 菜单 when 条件过滤掉，不会调用本命令。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { navigateToNode } from './navigate';

/** 注册"跳转到调用位置"命令 */
export function registerJumpToCaller(context: vscode.ExtensionContext, tree: NavTree): void {
  const disposable = vscode.commands.registerCommand(
    'backtrace.jumpToCaller',
    (node: NavNode) => {
      if (!node || !node.callerUri || node.callerLine == null || node.callerColumn == null) {
        return;
      }
      // 更新 currentNode 到父节点（与 goBack 行为一致）
      if (node.parent) {
        tree.currentNode = node.parent;
      }
      // 跳转到父节点的调用位置（而非父节点函数的初始位置）
      navigateToNode({
        uri: node.callerUri,
        line: node.callerLine,
        column: node.callerColumn,
      });
      vscode.commands.executeCommand('backtrace._treeChanged');
    },
  );
  context.subscriptions.push(disposable);
}
