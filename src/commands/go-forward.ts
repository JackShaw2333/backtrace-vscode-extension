/**
 * "前进"命令。
 *
 * 注册 backtrace.goForward 命令（默认快捷键 Ctrl+Alt+] ）。
 *
 * 行为：根据当前节点的子节点数量决定
 * - 0 个 → 提示"没有前进位置"
 * - 1 个 → 直接进入（同步，无需用户选择）
 * - 多个 → 取决于 backtrace.forwardBehavior 设置：
 *     'notification'（默认）→ 状态栏提示，用户通过 UI 选择
 *     'quickpick'           → 弹出 QuickPick 列表让用户选择（异步，需要 await）
 *
 * 为什么 goForward 有 async 而 goBack 没有？
 *   导航树的特性：每个节点只有一个 parent（后退路径唯一），
 *   但可以有多个 children（前进路径可能分叉）。
 *   分叉时需要用户选 → showQuickPick 是异步的 → 需要 async/await。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { navigateToNode } from './go-back';
import { readConfig } from '../config';

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

    // 多个选项 → 根据用户设置决定行为
    const config = readConfig();

    // switch 比 if/else 更适合有多个枚举值的分支。
    // 加上 default 分支确保即使未来新增了模式也不会静默走错路径。
    switch (config.forwardBehavior) {
      case 'notification': {
        // notification 模式（默认）：状态栏提示 + 引导用户使用 UI
        // 用户可以通过侧边栏 Backtrace Tree 或底部 Stack 面板选择目标分支
        // 提示中同时告知用户可在设置中修改行为
        vscode.window.setStatusBarMessage(
          '$(arrow-right) Backtrace: ' +
            options.length +
            ' forward locations available — use Backtrace Tree sidebar. ' +
            '(Change via backtrace.forwardBehavior in settings)',
          5000,
        );
        return;
      }
      case 'quickpick': {
        // quickpick 模式：弹出选择框让用户选择
        // "& { index: number }" 是 TypeScript 的交叉类型（Intersection Type），
        // 意思是在 QuickPickItem 的基础上额外加一个 index 属性。
        const items: (vscode.QuickPickItem & { index: number })[] = options.map((node, index) => {
          const uri = vscode.Uri.parse(node.uri);
          const fileName = uri.path.split('/').pop() || uri.path;
          return {
            label: `$(symbol-method) ${node.symbolName || '(symbol)'}`,
            description: `${fileName}:${node.line}`,
            detail: uri.path,
            index,
          };
        });

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Choose a forward navigation target',
        });

        if (picked) {
          tree.goForward(picked.index);
          navigateToNode(options[picked.index]);
          vscode.commands.executeCommand('backtrace._treeChanged');
        }
        return;
      }
      default: {
        // 未知模式（可能是未来添加的但未处理的新值）→ 静默忽略
        // 可以用 console.warn 记录，但不影响用户体验
        console.warn('Backtrace: unknown forwardBehavior:', config.forwardBehavior);
        return;
      }
    }
  });

  context.subscriptions.push(disposable);
}
