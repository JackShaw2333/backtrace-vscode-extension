import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { CommandWatcher } from './command-watcher';
import { readConfig } from './config';
import { PERSISTENCE_KEY } from './constants';
import { registerGoBack } from './commands/go-back';
import { registerGoForward } from './commands/go-forward';
import { BacktraceTreeProvider, registerJumpCommand } from './providers/tree-data-provider';
import { BacktraceStackProvider } from './providers/stack-panel-provider';

let commandWatcher: CommandWatcher;
let treeProvider: BacktraceTreeProvider;
let stackProvider: BacktraceStackProvider;

export function activate(context: vscode.ExtensionContext) {
    const config = readConfig();

    // Initialize NavTree
    const tree = new NavTree(config.maxTreeDepth);

    // Restore persisted tree
    if (config.persistHistory) {
        const saved = context.globalState.get<ReturnType<typeof tree.serialize>>(PERSISTENCE_KEY);
        if (saved) {
            tree.deserialize(saved);
        }
    }

    // Persist on changes (debounced)
    let persistTimer: NodeJS.Timeout | null = null;
    const persistHandler = vscode.commands.registerCommand('backtrace._treeChanged', () => {
        if (treeProvider) treeProvider.refresh();
        if (stackProvider) stackProvider.update();

        if (!config.persistHistory) return;
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            context.globalState.update(PERSISTENCE_KEY, tree.serialize());
        }, 500);
    });
    context.subscriptions.push(persistHandler);

    // Register commands
    registerGoBack(context, tree);
    registerGoForward(context, tree);
    registerJumpCommand(context, tree);

    // Register sidebar tree view
    treeProvider = new BacktraceTreeProvider(tree);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('backtraceTree', treeProvider)
    );

    // Register stack panel
    stackProvider = new BacktraceStackProvider(context.extensionUri, tree);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(BacktraceStackProvider.viewType, stackProvider)
    );

    // Start command watcher
    commandWatcher = new CommandWatcher(tree);
    commandWatcher.activate(config, context);

    // Listen for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('backtrace')) {
                const newConfig = readConfig();
                tree.maxDepth = newConfig.maxTreeDepth;
                commandWatcher.deactivate();
                commandWatcher.activate(newConfig, context);
            }
        })
    );

    // If tree is empty, show welcome view
    vscode.commands.executeCommand('setContext', 'backtrace.isEmpty', !tree.root);

    console.log('Backtrace extension activated');
}

export function deactivate() {
    if (commandWatcher) {
        commandWatcher.deactivate();
    }
}
