/**
 * 扩展入口。
 *
 * activate 在 VSCode 启动后（onStartupFinished）执行。
 * deactivate 在扩展关闭时执行。
 *
 * 这个文件负责"组装"所有模块：
 * 1. 创建 NavTree，从持久化存储恢复
 * 2. 注册命令（goBack、goForward、内部命令）
 * 3. 注册 UI 视图（侧边栏树、底部面板）
 * 4. 启动命令监听器
 * 5. 监听配置变化
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { CommandWatcher } from './command-watcher';
import { readConfig } from './config';
import { PERSISTENCE_KEY } from './constants';
import { registerGoBack } from './commands/go-back';
import { registerGoForward } from './commands/go-forward';
import { BacktraceTreeProvider, registerJumpCommand } from './providers/tree-data-provider';
import { BacktraceStackProvider } from './providers/stack-panel-provider';

// 模块级变量，activate 中赋值，deactivate 中清理
let commandWatcher: CommandWatcher;
let treeProvider: BacktraceTreeProvider;
let stackProvider: BacktraceStackProvider;

export function activate(context: vscode.ExtensionContext) {
    const config = readConfig();
    const tree = new NavTree(config.maxTreeDepth);

    // 从 globalState 恢复导航树（如果启用了持久化）
    if (config.persistHistory) {
        const saved = context.globalState.get<ReturnType<typeof tree.serialize>>(PERSISTENCE_KEY);
        if (saved) {
            tree.deserialize(saved);
        }
    }

    // 注册"树变化"事件处理器：刷新 UI + 防抖持久化
    let persistTimer: NodeJS.Timeout | null = null;
    const persistHandler = vscode.commands.registerCommand('backtrace._treeChanged', () => {
        treeProvider?.refresh();  // ?. 可选链：可能还没赋值
        stackProvider?.update();

        if (!config.persistHistory) return;
        if (persistTimer) clearTimeout(persistTimer);           // 防抖：500ms 内只写最后一次
        persistTimer = setTimeout(() => {
            context.globalState.update(PERSISTENCE_KEY, tree.serialize());
        }, 500);
    });
    context.subscriptions.push(persistHandler);

    // 注册导航命令
    registerGoBack(context, tree);
    registerGoForward(context, tree);
    registerJumpCommand(context, tree);

    // 注册侧边栏树视图（ID 必须和 package.json 一致）
    treeProvider = new BacktraceTreeProvider(tree);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('backtraceTree', treeProvider));

    // 注册底部堆栈面板
    stackProvider = new BacktraceStackProvider(context.extensionUri, tree);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(BacktraceStackProvider.viewType, stackProvider));

    // 启动命令监听器
    commandWatcher = new CommandWatcher(tree);
    commandWatcher.activate(config, context);

    // 监听配置变化，自动重新加载
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('backtrace')) {
                const newConfig = readConfig();
                tree.maxDepth = newConfig.maxTreeDepth;
                commandWatcher.deactivate();
                commandWatcher.activate(newConfig, context);
            }
        }),
    );

    // 设置"空树"上下文变量，用于 package.json 中的 viewsWelcome 条件显示
    vscode.commands.executeCommand('setContext', 'backtrace.isEmpty', !tree.root);

    console.log('Backtrace extension activated');
}

export function deactivate() {
    commandWatcher?.deactivate();
}
