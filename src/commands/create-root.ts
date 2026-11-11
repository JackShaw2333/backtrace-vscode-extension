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
 *
 * 位置语义：严格记录命令执行时的**光标位置**（editor.selection.active），
 * 不做“吸附到符号声明处”。用户把光标放哪，根就锚在哪。
 *
 * 符号身份单独处理：symbolName/contextName 优先取光标所在的包围符号
 * （而不是光标处的单词）。原因：光标可能停在函数上方的注释/Javadoc 行，
 * 此时“光标处的单词”是注释里的词；若拿它当 symbolName，之后点击根做
 * 符号重定位会找不到符号、把根本身误标成 stale。没有符号上下文时才回退
 * 到光标单词。
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

    // 光标处单词：只在“没有任何符号上下文”时作为符号名兜底。
    const wordRange = editor.document.getWordRangeAtPosition(position);
    const word = wordRange ? editor.document.getText(wordRange) : '';

    // 位置用光标；符号身份用包围符号（fallback 传空，避免注释单词
    // 抢占真实符号名）。没有符号（纯文本/无语言服务）时回退光标单词。
    const nodeContext = await getNodeContext(uri, line, column, '');
    const rootSymbolName = nodeContext.symbolName === '(symbol)' && word ? word : nodeContext.symbolName;
    tree.addRoot(uri, line, column, rootSymbolName, nodeContext.contextName);

    vscode.commands.executeCommand('backtrace._treeChanged');
    vscode.window.setStatusBarMessage(
      `$(home) Backtrace: root created — ${nodeContext.contextName || rootSymbolName}`,
      4000,
    );
  });
  context.subscriptions.push(disposable);
}
