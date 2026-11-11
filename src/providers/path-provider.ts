/**
 * 侧边栏堆栈视图（Explorer 中的 "Backtrace Stack"）。
 *
 * 以扁平列表显示从根节点到当前节点的线性路径。
 * 每层一个节点，无嵌套层级——类似函数调用栈的回溯列表。
 *
 * 显示位置：左侧 Activity Bar → Explorer → "Backtrace Stack" 区域
 *
 * TreeDataProvider 是 VSCode 的标准接口：把数据（NavNode）翻译成 VSCode 能显示的 TreeItem。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS, STALE_COLOR } from '../constants';
import { navigateToNodeResolved } from '../commands/navigate';

export class BacktracePathProvider implements vscode.TreeDataProvider<NavNode> {
  /**
   * _onDidChangeTreeData（事件发射器）：
   *   这是 VSCode 的机制：树内容变化时，调用 .fire() 发射事件，
   *   VSCode 收到后自动刷新树视图。
   *
   * 为什么用下划线 _ 开头？
   *   这个属性是"私有"的（虽然 TypeScript 没强制 private），
   *   下划线是约定俗成的标记：不要直接从外部调用。
   *   外部应该通过 refresh() 方法来触发刷新。
   *
   * 泛型 <NavNode | undefined> 表示事件的数据类型：
   *   fire(undefined) = 整棵树都变了，全部刷新
   *   fire(某个节点) = 只有这个节点变了
   */
  private _onDidChangeTreeData = new vscode.EventEmitter<NavNode | undefined>();

  /**
   * onDidChangeTreeData（只读的事件监听器）：
   *   这是 VSCode 框架调用的属性，用于订阅刷新事件。
   *   getter 语法（get）允许像属性一样访问，实际执行的是函数。
   *   "readonly" 防止外部代码意外替换掉这个监听器。
   */
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /**
   * constructor 的参数属性快捷写法：
   *   private tree: NavTree 自动创建 this.tree
   *   为什么存 tree？因为需要读取 tree.root 和 tree.currentNode 来渲染
   */
  constructor(private tree: NavTree) {}

  /** 通知 VSCode 刷新整个树视图 */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * 把数据节点转成 VSCode 的树节点（TreeItem）。
   * 每个属性控制树节点的一个视觉方面。
   */
  getTreeItem(element: NavNode): vscode.TreeItem {
    const isCurrent = element === this.tree.currentNode;
    // 树视图：缩略信息，只显示文件名:函数名
    // 根优先显示自定义 label；否则回退到符号上下文（与底部面板一致）。
    const display = element.label || element.contextName || element.symbolName || '(root)';
    const item = new vscode.TreeItem(display);

    // description：标题右边的灰色文字，显示文件名:行号
    // 若节点记录了调用者位置，追加 "← from <父文件名>:<行号>"
    // 方便回溯浏览时一眼看到"本节点是从父节点的哪一行跳过来的"。
    const callerSuffix =
      element.callerUri && element.callerLine != null
        ? `  ← from ${this.shortFileName(element.callerUri)}:${element.callerLine}`
        : '';
    // stale 后缀：光靠灰色对色弱用户不友好，文字后缀是第二重信号。
    // 和底部面板保持同一格式，两个视图看起来一致。
    const staleSuffix = element.stale ? '  · stale' : '';
    item.description = `${this.shortFileName(element.uri)}:${element.line}${callerSuffix}${staleSuffix}`;

    // color：标题的颜色。'as any' 是 TypeScript 的类型断言（type assertion）：
    //   (item as any) 告诉 TypeScript "把 item 当作 any 类型处理"，
    //   这样就能访问任何属性（包括 .color），且不会报类型错误。
    //
    // 为什么需要 (item as any)？
    //   @types/vscode 的 TreeItem 类型没有声明 .color 属性，
    //   但 VSCode 运行时确实支持它。类型断言是"绕过类型检查"的方式。
    //
    // 为什么 ESLint 报错 "Unexpected any"？
    //   @typescript-eslint/no-explicit-any 规则禁止使用 any，
    //   因为 any 会完全关闭类型检查——本应编译报错的代码也不会报错了。
    //   这里用 eslint-disable-next-line 禁用了这行检查，是故意为之。
    // 过期节点置灰：覆盖掉文件彩色，一眼区分。STALE_COLOR 选中灰的理由
    // 见 constants.ts（深色/浅色主题都可读）。非过期节点走原来的文件彩色。
    // tooltip 解释"为什么灰" + "点它会重试"，避免用户以为是 bug。
    if (element.stale) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any).color = STALE_COLOR;
      item.tooltip =
        `Original symbol "${element.symbolName || '(symbol)'}" was not found in the current file.\n` +
        `It may have been moved or deleted. Click to retry — it revives automatically if found again.`;
    } else {
      const colorIndex = this.getFileColorIndex(element.uri);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any).color = FILE_COLORS[colorIndex % FILE_COLORS.length];
    }

    // iconPath：节点图标。当前节点用箭头，其他用函数图标
    item.iconPath = isCurrent ? new vscode.ThemeIcon('arrow-right') : new vscode.ThemeIcon('symbol-method');

    // command：用户点击时执行的命令
    item.command = {
      command: 'backtrace._jumpToNode',
      title: 'Jump to location',
      arguments: [element],
    };

    // contextValue：用于上下文菜单和 when 表达式
    // 所有根（不只是活动根）都设为 'root'，用于过滤掉"跳转到调用位置"
    // 按钮——根节点没有调用者；判断依据是 parent 为空而不是 === tree.root。
    if (element.parent === null) {
      item.contextValue = 'root';
    } else {
      item.contextValue = isCurrent ? 'currentNode' : 'node';
    }
    return item;
  }

  /** 获取子节点。返回从根到当前的完整线性路径作为扁平列表（无嵌套） */
  getChildren(element?: NavNode): NavNode[] {
    if (this.tree.roots.length === 0) return [];
    // 只在顶层返回完整路径，子层级永远返回空（保证扁平列表效果）。
    // 注意：这里显示的是“活动根 → currentNode”的那一条路径，
    // 切换根通过底部面板点击完成（点击后活动根会跟随）。
    if (element) return [];
    return this.pathToCurrent();
  }

  /** 收集从根到当前节点的线性路径 */
  private pathToCurrent(): NavNode[] {
    const path: NavNode[] = [];
    // 从 currentNode 向上回溯到根，再反转顺序
    let cur: NavNode | null = this.tree.currentNode;
    while (cur) {
      path.push(cur);
      cur = cur.parent;
    }
    return path.reverse();
  }

  /** 获取父节点（扁平列表下始终返回 null，无层级关系） */
  getParent(_element: NavNode): NavNode | null {
    return null;
  }

  /**
   * 从 URI 中提取简短的文件名。
   *
   * .pop() 是 JavaScript 的数组方法：**删除数组最后一个元素，并返回它**。
   *   例：['file:', '', 'c:', 'app.ts'].pop() → 'app.ts'
   *   原数组变为 ['file:', '', 'c:']
   *
   * 步骤拆解：
   *   uri.split('/')          → 按 / 分割字符串为数组
   *                             "file:///c:/a.ts" → ["file:", "", "", "c:", "a.ts"]
   *   .pop()                  → 取数组的最后一个元素 → "a.ts"
   *   || uri.split('\\').pop()→ 如果是 Windows 路径，用 \ 分割再取最后一段
   *   || uri                  → 上面两步都失败时，用原字符串兜底
   *
   * 为什么用 ||（逻辑或）连接？
   *   || 返回第一个"真值"（truthy）。空字符串是"假值"（falsy），
   *   所以 .pop() 拿到空字符串时会自动试下一个。
   */
  private shortFileName(uri: string): string {
    return uri.split('/').pop() || uri.split('\\').pop() || uri;
  }

  /**
   * fileColorMap（文件 → 颜色索引 的映射表）：
   *   为什么需要这个？同一文件的所有节点应该显示同一种颜色。
   *   Map 是 ES6 的键值对集合，比普通对象更适合做映射。
   *   因为键是字符串（URI），Map 和对象的性能差不多。
   */
  private fileColorMap = new Map<string, number>();

  /**
   * nextColorIndex（下一个可用的颜色索引）：
   *   每遇到一个新文件就 +1，循环使用 FILE_COLORS 调色板。
   */
  private nextColorIndex = 0;

  /** 获取文件对应的颜色索引（首次访问自动分配新颜色） */
  private getFileColorIndex(uri: string): number {
    if (!this.fileColorMap.has(uri)) {
      this.fileColorMap.set(uri, this.nextColorIndex++);
    }
    return this.fileColorMap.get(uri)!;
  }
}

/**
 * 注册内部命令 _jumpToNode。
 * 这个命令不在命令面板显示，只有树视图的点击操作会触发它。
 * 为什么需要单独注册？TreeItem.command 只能引用一个命令 ID。
 */
export function registerJumpCommand(context: vscode.ExtensionContext, tree: NavTree): void {
  // async：树点击同样先定位后跳转（stale 节点只提示不跳，不断链）。
  const disposable = vscode.commands.registerCommand('backtrace._jumpToNode', async (node: NavNode) => {
    if (!node) return;
    tree.currentNode = node; // 更新当前节点
    // 多根森林：点击别的树的节点时，活动根跟随该节点所在的树，
    // 这样侧边栏路径、reveal 和后续新增节点都会落在正确的上下文里。
    const root = tree.rootOf(node);
    if (root) {
      tree.setActiveRoot(root);
    }
    await navigateToNodeResolved(node); // 先定位后跳转
    vscode.commands.executeCommand('backtrace._treeChanged'); // 刷新 UI
  });
  context.subscriptions.push(disposable);
}
