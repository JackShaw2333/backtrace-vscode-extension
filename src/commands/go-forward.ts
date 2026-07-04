import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { navigateToNode } from './go-back';

export function registerGoForward(context: vscode.ExtensionContext, tree: NavTree): void {
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

        // Multiple children — show QuickPick
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
    });
    context.subscriptions.push(disposable);
}
