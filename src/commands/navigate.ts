/**
 * 导航工具：跳转到节点所在位置。
 *
 * 被 goBack、goForward、TreeDataProvider 共同使用。
 * 独立成文件而不是放在任意一个命令文件中，避免语义混淆。
 */

import * as vscode from 'vscode';

/**
 * 跳转到指定位置（文件 + 行列）。
 *
 * 类型定义 { uri: string; line: number; column: number } 只要求三个必要属性，
 * 不要求完整的 NavNode 对象——这叫"结构类型"（structural typing）。
 *
 * @param node 目标位置
 */
export function navigateToNode(node: { uri: string; line: number; column: number }): void {
  const uri = vscode.Uri.parse(node.uri);

  // openTextDocument 返回 Promise（异步操作：读取文件需要时间）
  vscode.workspace.openTextDocument(uri).then(
    (doc) => {
      // selection 参数：设置光标选中位置。
      // new vscode.Range(startLine, startCol, endLine, endCol)
      // start 和 end 相同 → 零宽度范围 = 光标定位
      vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(
          node.line - 1, node.column - 1,
          node.line - 1, node.column - 1,
        ),
      });
    },
    () => {
      // 文件可能已被删除 → 显示错误消息但不抛异常
      vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`);
    },
  );
}
