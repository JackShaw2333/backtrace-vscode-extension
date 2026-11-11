/**
 * 底部树视图面板（Panel → "Backtrace Tree"）。
 *
 * 多根森林下，这个视图是“全局地图”：
 *   - 顶层返回 tree.roots（每个根一棵树，顺序 = 用户创建顺序）；
 *   - 每个根用 home 图标 + "root ·" 前缀区分，并允许重命名；
 *   - 子节点展开/折叠与旧版一致，右键菜单提供提升为根/删除等操作。
 *
 * 区别于侧边栏路径视图（只显示活动根→currentNode 的线性路径），
 * 底部面板展开所有根、所有分支，完整展示整个探索森林。
 */
import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS, STALE_COLOR } from '../constants';

export class BacktraceTreePanelProvider implements vscode.TreeDataProvider<NavNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<NavNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /**
   * 节点 → 稳定 TreeItem.id。
   *
   * 为什么需要稳定 id？VSCode 用 id 保存展开/选中状态；没有 id 时
   * 每次 refresh 都视为新元素，展开状态会丢。WeakMap 的键随节点对象
   * 释放，不会阻止 GC。
   */
  private nodeIds = new WeakMap<NavNode, string>();
  private nextNodeId = 0;

  constructor(private tree: NavTree) {}

  refresh(): void {
    console.log('[Backtrace] TreeView refresh fired');
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: NavNode): vscode.TreeItem {
    const isRoot = element.parent === null;
    const isCurrent = element === this.tree.currentNode;
    // 根优先显示用户自定义 label；否则回退到符号上下文（Class#method）。
    const display = element.label || element.contextName || element.symbolName || '(root)';
    const fileName = this.shortFileName(element.uri);

    const item = new vscode.TreeItem({
      label: display,
      highlights: undefined,
    });
    item.id = this.idOf(element);

    // description: 当前节点加 ← current 后缀；根加 "root ·" 前缀；
    // 若节点记录了调用者位置，追加 "← from <父文件名>:<行号>"。
    const callerSuffix =
      element.callerUri && element.callerLine != null ? `  ← from ${fileName}:${element.callerLine}` : '';
    const currentMarker = isCurrent ? '  ← current' : '';
    // stale 后缀：和侧边栏同一格式（见 path-provider.ts），纯颜色不够，
    // 色弱用户靠这段文字识别过期节点。
    const staleSuffix = element.stale ? '  · stale' : '';
    const rootPrefix = isRoot ? 'root · ' : '';
    item.description = `${rootPrefix}${fileName}:${element.line}${callerSuffix}${currentMarker}${staleSuffix}`;

    // 过期节点置灰（覆盖文件彩色）+ tooltip 说明原因和"点击重试"。
    // 和侧边栏同一规则，保证两个视图视觉一致。
    if (element.stale) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any).color = STALE_COLOR;
      item.tooltip =
        `Original symbol "${element.symbolName || '(symbol)'}" was not found in the current file.\n` +
        `It may have been moved or deleted. Click to retry — it revives automatically if found again.`;
    } else {
      // 文件颜色
      const colorIndex = this.getFileColorIndex(element.uri);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any).color = FILE_COLORS[colorIndex % FILE_COLORS.length];
    }

    // 图标：根用 home，当前节点用实心圆，其他用函数图标。
    item.iconPath = isRoot
      ? new vscode.ThemeIcon('home')
      : isCurrent
        ? new vscode.ThemeIcon('circle-filled')
        : new vscode.ThemeIcon('symbol-method');

    // 点击跳转
    item.command = {
      command: 'backtrace._jumpToNode',
      title: 'Jump to location',
      arguments: [element],
    };

    // contextValue：根统一为 'root'，用于右键菜单 when 条件
    // （根不允许提升为根/跳转调用位置，但允许重命名/删除）。
    item.contextValue = isRoot ? 'root' : isCurrent ? 'currentNode' : 'node';

    // collapsibleState：告诉 VSCode 哪些节点可展开。
    // Expanded：默认展开（底部面板目标：一眼看到完整森林）
    item.collapsibleState =
      element.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;

    return item;
  }

  /** 获取子节点：顶层返回所有根（森林），其余返回子节点。 */
  getChildren(element?: NavNode): NavNode[] {
    if (!element) {
      return [...this.tree.roots];
    }
    return element.children;
  }

  /** 获取父节点：根的 parent 为 null，VSCode reveal 依赖它。 */
  getParent(element: NavNode): NavNode | null {
    return element.parent;
  }

  private idOf(node: NavNode): string {
    let id = this.nodeIds.get(node);
    if (!id) {
      id = `backtrace-node-${this.nextNodeId++}`;
      this.nodeIds.set(node, id);
    }
    return id;
  }

  private shortFileName(uri: string): string {
    return uri.split('/').pop() || uri.split('\\').pop() || uri;
  }

  private fileColorMap = new Map<string, number>();
  private nextColorIndex = 0;

  private getFileColorIndex(uri: string): number {
    if (!this.fileColorMap.has(uri)) {
      this.fileColorMap.set(uri, this.nextColorIndex++);
    }
    return this.fileColorMap.get(uri)!;
  }
}
