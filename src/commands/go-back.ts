/**
 * "后退"命令。
 *
 * 注册 backtrace.goBack 命令（默认快捷键 Ctrl+Alt+[ ）。
 * 功能：沿导航树的 parent 链向上回退一步。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { navigateToNode } from './navigate';

/** 注册后退命令 */
export function registerGoBack(context: vscode.ExtensionContext, tree: NavTree): void {
  const disposable = vscode.commands.registerCommand('backtrace.goBack', () => {
    const target = tree.goBack();
    if (!target) {
      vscode.window.setStatusBarMessage('$(arrow-left) Backtrace: Already at earliest location', 2000);
      return;
    }
    navigateToNode(target);
    vscode.commands.executeCommand('backtrace._treeChanged');
  });
  context.subscriptions.push(disposable);
}
