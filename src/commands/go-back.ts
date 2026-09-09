/**
 * "后退"命令。
 *
 * 注册 backtrace.goBack 命令（默认快捷键 Ctrl+Alt+[ ）。
 * 功能：沿导航树的 parent 链向上回退一步。
 *
 * 跳转走 navigateToNodeResolved（先定位后跳转）：
 * 落到 stale 节点时不断链——currentNode 照常移过去（上面 tree.goBack()
 * 已经移了），只是文件不跳 + 状态栏提示，由用户决定删还是留。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { navigateToNodeResolved } from './navigate';

/** 注册后退命令 */
export function registerGoBack(context: vscode.ExtensionContext, tree: NavTree): void {
  // async：重定位要等语言服务（await），和 goForward 一样是异步的。
  const disposable = vscode.commands.registerCommand('backtrace.goBack', async () => {
    const target = tree.goBack();
    if (!target) {
      vscode.window.setStatusBarMessage('$(arrow-left) Backtrace: Already at earliest location', 2000);
      return;
    }
    await navigateToNodeResolved(target);
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  context.subscriptions.push(disposable);
}
