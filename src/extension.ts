/**
 * 扩展入口。
 *
 * VSCode 扩展的激活/停用入口。
 * activate 在扩展被激活时执行（这里配置了 onStartupFinished，VSCode 启动后即激活）。
 * deactivate 在扩展关闭时执行。
 *
 * 这个文件负责"组装"所有模块，类似一个"总装车间"：
 *   1. 创建 NavTree（核心数据结构）
 *   2. 从持久化存储恢复导航树
 *   3. 注册所有命令（goBack、goForward、内部命令）
 *   4. 注册 UI 视图（侧边栏树、底部面板）
 *   5. 启动命令监听器
 *   6. 监听配置变化
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

// 模块级变量：
// 为什么放在函数外面？因为 deactivate() 也需要访问它们。
// 在 activate() 中赋值，在 deactivate() 中清理。
// 不能用 const，因为需要在 activate() 中赋值。
let commandWatcher: CommandWatcher;
let treeProvider: BacktraceTreeProvider;
let stackProvider: BacktraceStackProvider;

/**
 * VSCode 扩展激活入口。
 *
 * context 参数由 VSCode 注入，包含：
 *   - subscriptions: 放 disposable 对象的数组，扩展停用时自动全部清理
 *   - globalState: 全局键值对存储（JSON 化对象），类似浏览器的 localStorage
 *   - extensionUri: 扩展文件所在的目录路径
 */
export function activate(context: vscode.ExtensionContext) {
    // 1. 读取用户设置
    const config = readConfig();

    // 2. 创建导航树核心
    const tree = new NavTree(config.maxTreeDepth);

    // 3. 从保存的数据恢复导航树（如果启用了持久化）
    //    globalState 的数据在 VSCode 重启后保留。
    //    为什么用 get<ReturnType<typeof tree.serialize>>？
    //    这是 TypeScript 的高级用法：获取 serialize() 的返回值类型。
    //    这样保证存储和读取的类型一致。
    if (config.persistHistory) {
        const saved = context.globalState.get<ReturnType<typeof tree.serialize>>(
            PERSISTENCE_KEY,
        );
        if (saved) {
            tree.deserialize(saved);
        }
    }

    // 4. 注册"树变化"事件处理器
    //    这个命令由其他模块在导航变化时主动触发（executeCommand）
    //    为什么用 registerCommand 而不是 EventEmitter？因为 executeCommand
    //    可以被非 TypeScript 代码调用（比如 future 的 webview 或扩展）。
    let persistTimer: NodeJS.Timeout | null = null;

    const persistHandler = vscode.commands.registerCommand(
        'backtrace._treeChanged',
        () => {
            // ?. 可选链：treeProvider 和 stackProvider 在注册此命令的
            // 时刻可能还没赋值（它们在后面几行才被赋值），
            // 但被调用时一定已经赋值了。?. 防止万一。
            treeProvider?.refresh();
            stackProvider?.update();

            // 防抖（debounce）持久化：500ms 内只保存最后一次变化。
            // 因为连续导航可能一秒跳转多次，每次都写入 globalState
            // 会影响性能。500ms 的缓冲足够了。
            if (!config.persistHistory) return;
            if (persistTimer) clearTimeout(persistTimer);
            persistTimer = setTimeout(() => {
                context.globalState.update(PERSISTENCE_KEY, tree.serialize());
            }, 500);
        },
    );
    context.subscriptions.push(persistHandler);

    // 5. 注册导航命令
    registerGoBack(context, tree);
    registerGoForward(context, tree);
    registerJumpCommand(context, tree);

    // 6. 注册侧边栏树视图
    //    'backtraceTree' 必须是 package.json 中注册的视图 ID
    treeProvider = new BacktraceTreeProvider(tree);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('backtraceTree', treeProvider),
    );

    // 7. 注册底部堆栈面板
    stackProvider = new BacktraceStackProvider(context.extensionUri, tree);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            BacktraceStackProvider.viewType,
            stackProvider,
        ),
    );

    // 8. 启动命令监听器
    commandWatcher = new CommandWatcher(tree);
    commandWatcher.activate(config, context);

    // 9. 监听 VSCode 设置变化
    //    当用户修改 backtrace.* 设置时，自动重新加载配置。
    //    不需要用户重启 VSCode。
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

    // 10. 设置上下文变量，用于 package.json 中的 viewsWelcome 条件
    //     setContext 让 VSCode 知道当前树是否为空，
    //     为空时显示"帮助文字"引导用户使用。
    vscode.commands.executeCommand('setContext', 'backtrace.isEmpty', !tree.root);

    console.log('Backtrace extension activated');
}

/** 扩展停用时的清理入口 */
export function deactivate() {
    commandWatcher?.deactivate();
}
