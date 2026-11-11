/**
 * “光标处建根”命令。
 *
 * 为什么需要它？
 *   Spring Boot 这类框架把“框架入口 → 业务方法”的连接藏了起来，
 *   跳转历史天然只能从 controller 方法开始。用户把光标放在入口方法上
 *   （controller / @Scheduled / 事件监听器 / main / 测试方法），执行本命令，
 *   就显式标出了“本次探索从这里开始”；后续 F12 都挂在这棵新树下。
 *
 * 和 addJump 首跳隐式建根的区别：
 *   - 显式（命令触发，kind='manual'），不依赖任何跳转；
 *   - 森林非空时是“追加一棵新树”，旧树原样保留（换入口探索不丢历史）。
 *
 * 标签自动取包围符号的上下文路径（Class#method），失败回退单词/空字符串；
 * 需要人类可读标题时用“重命名根”命令覆盖（label 字段）。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { getNodeContext } from '../symbol-utils';

/** 注册 backtrace.createRoot 命令 */
export function registerCreateRoot(context: vscode.ExtensionContext, tree: NavTree): void {
  const disposable = vscode.commands.registerCommand('backtrace.createRoot', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.setStatusBarMessage('$(warning) Backtrace: open a file and place the cursor first', 3000);
      return;
    }

    const position = editor.selection.active;
    const uri = editor.document.uri.toString();
    const line = position.line + 1;
    const column = position.character + 1;

    // 光标处单词（找不到时为空），用作符号名兜底。
    const wordRange = editor.document.getWordRangeAtPosition(position);
    const word = wordRange ? editor.document.getText(wordRange) : '';

    // 复用符号上下文：根标签优先显示 contextName（Class#method）。
    // 这里有一次语言服务查询（DocumentSymbolProvider），失败会回退到 word。
    const nodeContext = await getNodeContext(uri, line, column, word);
    tree.addRoot(uri, line, column, nodeContext.symbolName, nodeContext.contextName);

    vscode.commands.executeCommand('backtrace._treeChanged');
    vscode.window.setStatusBarMessage(
      `$(home) Backtrace: root created — ${nodeContext.contextName || nodeContext.symbolName || 'current location'}`,
      4000,
    );
  });
  context.subscriptions.push(disposable);
}
