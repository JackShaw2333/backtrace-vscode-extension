/**
 * "前进"命令 (Ctrl+Alt+] )
 *
 * 行为取决于当前节点有几个前进选项：
 * - 0 个 → 提示"没有前进位置"
 * - 1 个 → 直接进入
 * - 多个 → 弹出 QuickPick 列表让用户选择
 *
 * async/await 用于处理异步操作（等待用户选择）。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { navigateToNode } from './go-back';

/** 注册 backtrace.goForward 命令 */
export function registerGoForward(context: vscode.ExtensionContext, tree: NavTree): void {
    const disposable = vscode.commands.registerCommand('backtrace.goForward', async () => {
        const options = tree.getForwardOptions();

        if (options.length === 0) {
            vscode.window.setStatusBarMessage('$(arrow-right) Backtrace: No forward locations', 2000);
            return;
        }

        if (options.length === 1) {
            // 唯一选项，直接前进
            tree.goForward(0);
            navigateToNode(options[0]);
            vscode.commands.executeCommand('backtrace._treeChanged');
            return;
        }

        // 多个选项 → 弹出选择框
        // & { index: number } 是交叉类型，在 QuickPickItem 基础上附加 index 属性
        const items: (vscode.QuickPickItem & { index: number })[] = options.map((node, index) => {
            const uri = vscode.Uri.parse(node.uri);
            const fileName = uri.path.split('/').pop() || uri.path;
            return {
                label: `$(symbol-method) ${node.symbolName || '(symbol)'}`,
                description: `${fileName}:${node.line}`,
                detail: uri.path,
                index, // 记住选项在数组中的位置
            };
        });

        // await 等待用户做出选择（showQuickPick 是异步的）
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
