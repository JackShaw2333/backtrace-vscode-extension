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
 *   4. 注册 UI 视图（侧边栏堆栈、底部树面板）
 *   5. 启动命令监听器
 *   6. 监听配置变化
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { NavNode } from './nav-node';
import { CommandWatcher } from './command-watcher';
import { readConfig } from './config';
import { PERSISTENCE_KEY } from './constants';
import { registerGoBack } from './commands/go-back';
import { registerGoForward } from './commands/go-forward';
import { registerDeleteNode } from './commands/delete-node';
import { registerJumpToCaller } from './commands/jump-to-caller';
import { BacktracePathProvider, registerJumpCommand } from './providers/path-provider';
import { BacktraceTreePanelProvider } from './providers/tree-panel-provider';

// 模块级变量：
// 为什么放在函数外面？因为 deactivate() 也需要访问它们。
// 在 activate() 中赋值，在 deactivate() 中清理。
// 不能用 const，因为需要在 activate() 中赋值。
let commandWatcher: CommandWatcher;
let pathProvider: BacktracePathProvider;
let treeProvider: BacktraceTreePanelProvider;
// TreeView 引用：用于 reveal() 展开节点。
// registerTreeDataProvider 不返回引用，所以改用 createTreeView。
let pathView: vscode.TreeView<NavNode>;
let treeView: vscode.TreeView<NavNode>;

/**
 * VSCode 扩展激活入口。
 *
 * context 参数由 VSCode 注入，包含：
 *   - subscriptions: 放 disposable 对象的数组，扩展停用时自动全部清理
 *   - workspaceState: 按 workspace 隔离的键值对存储，不同项目的数据互不干扰
 *   - extensionUri: 扩展文件所在的目录路径
 */
export function activate(context: vscode.ExtensionContext) {
  // 1. 读取用户设置
  const config = readConfig();

  // 2. 创建导航树核心
  const tree = new NavTree(config.maxTreeDepth);

  // 3. 从保存的数据恢复导航树（如果启用了持久化）
  //    workspaceState 的数据按 workspace 隔离，不同项目不共享。
  //    为什么用 get<ReturnType<typeof tree.serialize>>？
  //    这是 TypeScript 的高级用法：获取 serialize() 的返回值类型。
  //    这样保证存储和读取的类型一致。
  if (config.persistHistory) {
    const saved = context.workspaceState.get<ReturnType<typeof tree.serialize>>(PERSISTENCE_KEY);
    if (saved) {
      tree.deserialize(saved);
    }
  }

  // 4. 注册"树变化"事件处理器
  //    这个命令由其他模块在导航变化时主动触发（executeCommand）
  //    为什么用 registerCommand 而不是 EventEmitter？因为 executeCommand
  //    可以被非 TypeScript 代码调用（比如 future 的 webview 或扩展）。
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const persistHandler = vscode.commands.registerCommand('backtrace._treeChanged', () => {
    // ?. 可选链：pathProvider 和 treeProvider 在注册此命令的
    // 时刻可能还没赋值（它们在后面几行才被赋值），
    // 但被调用时一定已经赋值了。?. 防止万一。
    pathProvider?.refresh();
    treeProvider?.refresh();

    // reveal currentNode 确保新子节点可见。
    // TreeView 需要一小段时间处理 refresh，所以用 nextTick。
    // reveal({ expand: true }) 会展开父节点路径，让新子节点可见。
    if (tree.currentNode) {
      const cn = tree.currentNode;
      setTimeout(() => {
        pathView?.reveal(cn, { expand: true });
        treeView?.reveal(cn, { expand: 1 });
      }, 50);
    }

    // 更新"空树"上下文变量，控制 viewsWelcome 帮助文字的显示/隐藏。
    // setContext 只在 activate() 时执行一次，后续树变化时需要同步更新。
    vscode.commands.executeCommand('setContext', 'backtrace.isEmpty', !tree.root);

    // 防抖（debounce）持久化：500ms 内只保存最后一次变化。
    // 会影响性能。500ms 的缓冲足够了。
    //
    // 为什么不用 activate() 开头的 config.persistHistory？
    //   activate() 中的 config 是闭包捕获的旧值，用户修改设置后不会更新。
    //   readConfig().persistHistory 每次动态读取，保证拿到最新值。
    if (!readConfig().persistHistory) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      context.workspaceState.update(PERSISTENCE_KEY, tree.serialize());
    }, 500);
  });
  context.subscriptions.push(persistHandler);

  // 5. 注册导航命令
  registerGoBack(context, tree);
  registerGoForward(context, tree);
  registerDeleteNode(context, tree);
  registerJumpToCaller(context, tree);
  registerJumpCommand(context, tree);

  // 6. 注册侧边栏堆栈视图
  //    'backtraceStack' 必须是 package.json 中注册的视图 ID
  //    用 createTreeView 代替 registerTreeDataProvider，
  //    因为 createTreeView 返回 TreeView 引用，支持 reveal() 展开节点。
  pathProvider = new BacktracePathProvider(tree);
  pathView = vscode.window.createTreeView('backtraceStack', { treeDataProvider: pathProvider });
  context.subscriptions.push(pathView);

  // 7. 注册底部树视图面板
  treeProvider = new BacktraceTreePanelProvider(tree);
  treeView = vscode.window.createTreeView('backtraceTree', { treeDataProvider: treeProvider });
  context.subscriptions.push(treeView);

  // 8. 启动命令监听器
  commandWatcher = new CommandWatcher(tree);
  commandWatcher.activate(config);

  // 9. 监听 VSCode 设置变化
  //    当用户修改 backtrace.* 设置时，自动重新加载配置。
  //    不需要用户重启 VSCode。
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('backtrace')) {
        const newConfig = readConfig();
        tree.maxDepth = newConfig.maxTreeDepth;
        commandWatcher.deactivate();
        commandWatcher.activate(newConfig);
      }
    }),
  );

  // 10. 设置上下文变量，用于 package.json 中的 viewsWelcome 条件
  //     setContext 让 VSCode 知道当前树是否为空，
  //     为空时显示"帮助文字"引导用户使用。
  vscode.commands.executeCommand('setContext', 'backtrace.isEmpty', !tree.root);

  const restored = config.persistHistory && tree.root ? ` (${countNodes(tree.root)} nodes restored)` : '';
  console.log(`[Backtrace] activated${restored}`);
}

/** 递归统计节点数（用于启动日志） */
function countNodes(node: import('./nav-node').NavNode): number {
  let count = 1;
  for (const child of node.children) count += countNodes(child);
  return count;
}

/** 扩展停用时的清理入口 */
export function deactivate() {
  commandWatcher?.deactivate();
}
