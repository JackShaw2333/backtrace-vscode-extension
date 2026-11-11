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
 * 关于源码改动后的漂移：
 *   这里故意用笨跳 navigateToNode（不做跳转时重定位），因为调用点
 *   只存了行列、没存符号身份——调用点是函数体内的某一行（调用表达式），
 *   不是符号定义处，按"符号身份"根本定位不到它。
 *   它的保鲜全靠 position-tracker 实时跟随（会话内编辑逐条修正
 *   callerLine/callerColumn）。会话外的大改动可能让它漂移，
 *   这是已知取舍：调用点精确到"行"，漂几行的代价可接受；
 *   真要根治得在记录时多存调用点的上下文身份，留待以后。
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
  const disposable = vscode.commands.registerCommand('backtrace.jumpToCaller', (node: NavNode) => {
    if (!node || !node.callerUri || node.callerLine == null || node.callerColumn == null) {
      return;
    }
    // 更新 currentNode 到父节点（与 goBack 行为一致）
    if (node.parent) {
      tree.currentNode = node.parent;
      // 多根森林：父节点可能在别的树里（例如从底部面板点了非活动根
      // 节点的“跳转到调用位置”），活动根要跟着 current 一起切过去，
      // 否则侧边栏路径/后续新增节点会落在错误的上下文。
      const root = tree.rootOf(node.parent);
      if (root) {
        tree.setActiveRoot(root);
      }
    }
    // 跳转到父节点的调用位置（而非父节点函数的初始位置）
    navigateToNode({
      uri: node.callerUri,
      line: node.callerLine,
      column: node.callerColumn,
    });
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  context.subscriptions.push(disposable);
}
