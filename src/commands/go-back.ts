import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';

export function registerGoBack(context: vscode.ExtensionContext, tree: NavTree): void {
    const disposable = vscode.commands.registerCommand('backtrace.goBack', () => {
        const target = tree.goBack();
        if (!target) {
            vscode.window.setStatusBarMessage('$(arrow-left) Backtrace: Already at earliest location', 2000);
            return;
        }
        navigateToNode(target);
        vscode.commands.executeCommand('backtrace._treeChanged');
    });
    context.subscriptions.push(disposable);
}

/** Shared helper to open a document at a NavNode's position */
export function navigateToNode(node: { uri: string; line: number; column: number }): void {
    const uri = vscode.Uri.parse(node.uri);
    vscode.workspace.openTextDocument(uri).then((doc) => {
        vscode.window.showTextDocument(doc, {
            selection: new vscode.Range(
                node.line - 1, node.column - 1,
                node.line - 1, node.column - 1
            ),
        });
    });
}
