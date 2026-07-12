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

    // executeCommand 是 VSCode 的"全局事件总线"：可以触发任意注册过的命令。
    // 'backtrace._treeChanged' 是一个内部命令（下划线开头表示"不对外公开"），
    // 在 extension.ts 第 68 行注册。
    //
    // 它做了两件事：
    //   ① treeProvider.refresh() → 刷新侧边栏的 Backtrace Tree 树视图
    //   ② stackProvider.update() → 刷新底部面板的 Backtrace Stack
    //
    // 同时还在 500ms 防抖后把导航树保存到 VSCode 的持久化存储中。
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

  // ── Promise 是什么？ ──
  //
  // openTextDocument(uri) 返回一个 Promise（"承诺"）。
  // Promise 是 JavaScript 处理"将来才完成的操作"的标准方式。
  //
  // 为什么需要 Promise？
  //   打开文件是一个异步操作：VSCode 需要从磁盘读取文件内容，
  //   这个读取需要时间（哪怕只是几毫秒）。
  //   如果不用 Promise，代码会"卡住"等待文件读完。
  //   用 Promise，代码继续执行后面的语句，文件读完后自动执行 .then()。
  //
  // Promise 的三种状态：
  //   pending（等待中） → fulfilled（成功，进入 .then 的第一个回调）
  //                     → rejected（失败，进入 .then 的第二个回调）
  //   就像点外卖：下单（pending）→ 送到（fulfilled）或 取消（rejected）
  //
  // 这里的 .then(成功回调, 失败回调) 做了两件事：
  //   成功：doc 参数就是打开的文件对象 → showTextDocument 显示它
  //   失败：文件打不开（已删除/权限问题）→ 显示错误消息
  //
  // 为什么错误处理很重要？
  //   如果不处理错误，Promise 失败时会抛出一个"未捕获的异常"，
  //   VSCode 的日志中会出现红色报错，影响扩展的稳定性评分。
  vscode.workspace.openTextDocument(uri).then(
    (doc) => {
      // showTextDocument: 切换到目标文件的 tab（如果文件已打开，不会重复打开）。
      //
      // selection 参数：设置光标选中位置。
      //   new vscode.Range(startLine, startCol, endLine, endCol) 定义了一个选中范围。
      //   这里 start 和 end 相同（行和列都一致），所以选中的是一个空范围 = 光标定位。
      //   效果：文件切换到前台，光标停留在 node.line:node.column。
      //
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
