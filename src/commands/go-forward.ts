/**
 * "前进"命令。
 *
 * 注册 backtrace.goForward 命令（默认快捷键 Ctrl+Alt+] ）。
 *
 * 行为：根据当前节点的子节点数量决定
 * - 0 个 → 提示"没有前进位置"
 * - 1 个 → 直接进入（同步，无需用户选择）
 * - 多个 → 弹出 QuickPick 列表让用户选择（异步，需要 await）
 *
 * 为什么 goForward 有 async 而 goBack 没有？
 *   导航树的特性：每个节点只有一个 parent（后退路径唯一），
 *   但可以有多个 children（前进路径可能分叉）。
 *   分叉时需要用户选 → showQuickPick 是异步的 → 需要 async/await。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { navigateToNode } from './go-back';

/** 注册前进命令 */
export function registerGoForward(context: vscode.ExtensionContext, tree: NavTree): void {
  // 这里的 async 表示回调函数是异步的。
  //
  // 为什么 goForward 是 async 而 goBack 不是？
  //   导航树的特性：每个节点只有一个 parent（后退路径唯一），
  //   但可以有多个 children（前进路径可能分叉）。
  //   当有多个子节点时，需要弹出 QuickPick 让用户选择去哪条分支。
  //   showQuickPick 是异步的——它返回一个 Promise，在用户做出选择后才 resolve。
  //   所以需要 async/await 来等待用户选择。
  //
  // 如果不用 async/await 会怎样？
  //   showQuickPick 会立即返回（在用户选择之前），
  //   picked 会是 undefined，后续代码无法正确执行。
  const disposable = vscode.commands.registerCommand('backtrace.goForward', async () => {
    const options = tree.getForwardOptions();

    if (options.length === 0) {
      vscode.window.setStatusBarMessage('$(arrow-right) Backtrace: No forward locations', 2000);
      return;
    }

    if (options.length === 1) {
      tree.goForward(0);
      navigateToNode(options[0]);
      vscode.commands.executeCommand('backtrace._treeChanged');
      return;
    }

    // 多个选项 → 弹出选择框
    // "& { index: number }" 是 TypeScript 的交叉类型（Intersection Type），
    // 意思是在 QuickPickItem 的基础上额外加一个 index 属性。
    // 为什么需要 index？用户选完后需要知道选的是第几个选项。
    const items: (vscode.QuickPickItem & { index: number })[] = options.map((node, index) => {
      const uri = vscode.Uri.parse(node.uri);
      const fileName = uri.path.split('/').pop() || uri.path;
      return {
        label: `$(symbol-method) ${node.symbolName || '(symbol)'}`,
        description: `${fileName}:${node.line}`,
        detail: uri.path,
        index, // 自定义属性：记录选项在数组中的位置
      };
    });

    // await 暂停函数执行，直到用户做出选择
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Choose a forward navigation target',
    });

    if (picked) {
      tree.goForward(picked.index);
      navigateToNode(options[picked.index]);
      vscode.commands.executeCommand('backtrace._treeChanged');
    }
  });

  context.subscriptions.push(disposable);
}
