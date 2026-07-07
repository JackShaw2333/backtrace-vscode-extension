/**
 * "后退"命令 (Ctrl+Alt+[ )
 *
 * 沿导航树的 parent 链向上回退一步。
 * navigateToNode() 同时被 goForward 和 TreeDataProvider 复用。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';

/** 注册 backtrace.goBack 命令（默认快捷键 Ctrl+Alt+[） */
export function registerGoBack(context: vscode.ExtensionContext, tree: NavTree): void {
    const disposable = vscode.commands.registerCommand('backtrace.goBack', () => {
        const target = tree.goBack();

        if (!target) {
            // 已在树根，状态栏提示 2 秒后消失
            vscode.window.setStatusBarMessage('$(arrow-left) Backtrace: Already at earliest location', 2000);
            return;
        }

        navigateToNode(target);
        vscode.commands.executeCommand('backtrace._treeChanged');
    });

    context.subscriptions.push(disposable);
}

/**
 * 共享工具：跳转到节点所在位置。
 * 被 goBack、goForward、TreeDataProvider 共同使用。
 *
 * @param node 只需 uri, line, column 三个属性
 */
export function navigateToNode(node: { uri: string; line: number; column: number }): void {
    const uri = vscode.Uri.parse(node.uri);

    // .then() 是 Promise 语法。第二个参数是错误处理函数
    vscode.workspace.openTextDocument(uri).then(
        (doc) => {
            // VSCode 行列从 0 开始，我们存的时候 +1，这里 -1
            vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(
                    node.line - 1, node.column - 1,
                    node.line - 1, node.column - 1
                ),
            });
        },
        () => {
            vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`);
        },
    );
}
