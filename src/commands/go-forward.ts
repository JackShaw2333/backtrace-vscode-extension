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
  // 为什么分支选择必须等用户响应就要用异步？
  //
  // JavaScript 是单线程 + 事件循环模型：
  //   所有代码和 UI 渲染都在同一个线程上运行。
  //   如果 showQuickPick 是"同步等待"（阻塞），
  //   它会卡住这个线程 → UI 无法渲染 → 用户看不到 QuickPick → 永远点不了 → 死锁。
  //
  // 所以 showQuickPick 被设计为异步 API：
  //   ① 调用时，VSCode 弹出选择框，函数立即返回（不阻塞）
  //   ② JavaScript 继续执行后面的代码（如果有的话）
  //   ③ 用户做出选择后，Promise resolve，await 后面的代码才执行
  //
  // 类比：去餐厅吃饭
  //   同步 = 站在柜台等厨师做完（阻塞，什么都不能干）
  //   异步 = 拿号回座等叫号（不阻塞，可以刷手机，号到了再去取餐）
  //
  // 为什么 goBack 不需要 async？
  //   后退直接执行跳转，不需要用户选择，没有"等待"环节。
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
