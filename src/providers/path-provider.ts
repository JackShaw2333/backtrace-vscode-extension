/**
 * 侧边栏路径视图（Explorer 中的 "Backtrace Stack"）。
 *
 * 显示从根节点到当前节点的线性路径（类似堆栈回溯），
 * 每层只展示一个子节点——朝向 currentNode 的那一个。
 *
 * 显示位置：左侧 Activity Bar → Explorer → "Backtrace Stack" 区域
 *
 * TreeDataProvider 是 VSCode 的标准接口，有点像"翻译器"：
 *   把数据（NavNode）翻译成 VSCode 能显示的样子（TreeItem）。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';
import { navigateToNode } from '../commands/navigate';

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
    const display = element.contextName || element.symbolName || '(root)';
    const item = new vscode.TreeItem(display);

    // description：标题右边的灰色文字，显示文件名:行号
    item.description = `${this.shortFileName(element.uri)}:${element.line}`;

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
    const colorIndex = this.getFileColorIndex(element.uri);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item as any).color = FILE_COLORS[colorIndex % FILE_COLORS.length];

    // iconPath：节点图标。当前节点用箭头，其他用函数图标
    item.iconPath = isCurrent ? new vscode.ThemeIcon('arrow-right') : new vscode.ThemeIcon('symbol-method');

    // command：用户点击时执行的命令
    item.command = {
      command: 'backtrace._jumpToNode',
      title: 'Jump to location',
      arguments: [element],
    };

    // contextValue：用于上下文菜单和 when 表达式
    item.contextValue = isCurrent ? 'currentNode' : 'node';
    return item;
  }

  /** 获取子节点。侧边栏只显示从根到当前的线性路径 */
  getChildren(element?: NavNode): NavNode[] {
    if (!this.tree.root) return [];
    if (!element) return [this.tree.root];  // 第一层：根节点
    // 后续层：返回朝向 currentNode 方向的子节点（最多一个）
    const next = this.childTowardCurrent(element);
    return next ? [next] : [];
  }

  /**
   * 在 element 的子节点中，找到"朝向 currentNode 方向"的那一个。
   * 算法：从 currentNode 沿 parent 链上溯到 element 的层级，
   * 返回那个子节点。
   */
  private childTowardCurrent(node: NavNode): NavNode | null {
    let cur = this.tree.currentNode;
    while (cur && cur.parent) {
      if (cur.parent === node) return cur;
      cur = cur.parent;
    }
    return null;
  }

  /** 获取父节点（用于"在树中定位"功能） */
  getParent(element: NavNode): NavNode | null {
    return element.parent;
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
  const disposable = vscode.commands.registerCommand('backtrace._jumpToNode', (node: NavNode) => {
    if (!node) return;
    tree.currentNode = node; // 更新当前节点
    navigateToNode(node); // 跳转
    vscode.commands.executeCommand('backtrace._treeChanged'); // 刷新 UI
  });
  context.subscriptions.push(disposable);
}
