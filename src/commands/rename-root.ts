/**
 * “重命名根”命令。
 *
 * 只对根节点生效（普通节点显示符号名即可，没有命名的必要）。
 * 名称存在 NavNode.label，UI 优先显示它；留空则清掉 label，
 * 回退到自动标签（Class#method / 符号名 / 文件名）。
 *
 * 为什么需要它？
 *   Spring 场景下根的可读标题常常不是方法名，而是
 *   "GET /users/{id}" 或 "订单补偿定时任务"——自动标签给不出来，
 *   但用户一眼就知道自己在看哪条链。
 */

import * as vscode from 'vscode';
import { NavNode } from '../nav-node';

/** 注册 backtrace.renameRoot 命令（只改节点的 label，不需要操作树结构） */
export function registerRenameRoot(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('backtrace.renameRoot', async (node: NavNode) => {
    if (!node || node.parent) {
      return;
    }
    const current = node.label ?? (node.contextName || node.symbolName || '');
    const value = await vscode.window.showInputBox({
      prompt: 'Backtrace: root label (empty = use the automatic symbol name)',
      placeHolder: 'e.g. GET /users or 订单补偿任务',
      value: current,
      valueSelection: [0, current.length],
    });
    if (value === undefined) {
      return;
    }
    node.label = value.trim() ? value.trim() : null;
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  context.subscriptions.push(disposable);
}
