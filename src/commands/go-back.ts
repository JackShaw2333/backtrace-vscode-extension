/**
 * "后退"命令。
 *
 * 注册 backtrace.goBack 命令（默认快捷键 Ctrl+Alt+[ ）。
 * 功能：沿导航树的 parent 链向上回退一步。
 *
 * 同时导出了 navigateToNode 函数，供多个模块复用。
 * 为什么单独抽取 navigateToNode？goForward、TreeDataProvider 都要用，
 * 抽取出来避免重复代码。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';

/** 注册后退命令 */
export function registerGoBack(context: vscode.ExtensionContext, tree: NavTree): void {
  // registerCommand：把命令 ID 和回调函数绑定
  const disposable = vscode.commands.registerCommand('backtrace.goBack', () => {
    const target = tree.goBack();

    if (!target) {
      // 已在树根 → 状态栏提示 2 秒后自动消失
      // 为什么用 setStatusBarMessage？不打扰用户当前操作
      vscode.window.setStatusBarMessage('$(arrow-left) Backtrace: Already at earliest location', 2000);
      return;
    }

    navigateToNode(target);
    vscode.commands.executeCommand('backtrace._treeChanged');
  });

  context.subscriptions.push(disposable);
}

/**
 * 共享工具函数：跳转到节点所在位置。
 *
 * 类型定义 { uri: string; line: number; column: number }
 * 只要求传入三个必要属性，不要求完整的 NavNode 对象。
 * 这叫"鸭子类型"或"结构类型"：只要有这三个属性就能用。
 *
 * @param node 目标位置
 */
export function navigateToNode(node: { uri: string; line: number; column: number }): void {
  const uri = vscode.Uri.parse(node.uri);

  // .then() 是 Promise 的语法。
  // VSCode 的 API 大量使用 Promise（异步操作）。
  // 第一个函数：成功时执行；第二个函数：失败时执行。
  vscode.workspace.openTextDocument(uri).then(
    (doc) => {
      // VSCode 的行列从 0 开始计数，所以我们存的时候 +1，
      // 这里用的时候 -1，还原回 VSCode 的 0-based 坐标。
      vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(node.line - 1, node.column - 1, node.line - 1, node.column - 1),
      });
    },
    () => {
      // 文件可能已被删除。显示错误消息但不抛异常。
      vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`);
    },
  );
}
