/**
 * 导航树数据结构。
 *
 * 记录用户的导航历史，组织成一棵树：
 *
 *   A（起点）
 *   ├── B（从A跳到B）
 *   │   └── C（从B跳到C）
 *   └── D（回到A后，从A跳到D）
 *
 * "后退"就是沿 parent 向上走，"前进"就是沿 children 向下走。
 * 如果有多个子节点，弹出选择框让用户选去哪条分支。
 */

import { NavNode, SerializedNavNode, SerializedTree } from './nav-node';

/**
 * 调用者位置（从父节点的哪里跳转过来）。
 * 用于"跳转到调用位置"按钮精确回到触发 F12 的那一行，
 * 而不是父节点函数的初始位置。
 */
export interface CallerPosition {
  uri: string;
  line: number;
  column: number;
}

/**
 * NavTree 类 = 整棵导航树。
 */
export class NavTree {
  root: NavNode | null = null;
  currentNode: NavNode | null = null;
  maxDepth: number;

  constructor(maxDepth: number = 50) {
    this.maxDepth = maxDepth;
  }

  /**
   * 记录一次跳转。
   *
   * @param callerPosition 跳转前光标所在位置（即父节点的调用点）。
   *   根节点没有调用者，应传 null。旧调用方不传该参数时默认为 null，
   *   保持向后兼容。
   */
  addJump(
    uri: string,
    line: number,
    column: number,
    symbolName: string,
    contextName: string = '',
    callerPosition: CallerPosition | null = null,
  ): NavNode {
    console.log(`[Backtrace]   └ addJump → ${contextName || symbolName}`);
    const node: NavNode = {
      uri,
      line,
      column,
      symbolName,
      contextName,
      children: [],
      parent: null,
      timestamp: Date.now(),
      callerUri: callerPosition?.uri ?? null,
      callerLine: callerPosition?.line ?? null,
      callerColumn: callerPosition?.column ?? null,
    };

    if (!this.root) {
      // 根节点没有调用者：即使 callerPosition 被传入也强制清空，
      // 避免误把首次跳转前的位置当作"调用点"。
      node.callerUri = null;
      node.callerLine = null;
      node.callerColumn = null;
      this.root = node;
      this.currentNode = node;
    } else if (this.currentNode) {
      node.parent = this.currentNode;
      this.currentNode.children.push(node);
      this.currentNode = node;
    } else {
      node.parent = this.root;
      this.root!.children.push(node);
      this.currentNode = node;
    }

    this.pruneIfExceeded();
    this.dump('addJump');
    return node;
  }

  goBack(): NavNode | null {
    if (!this.currentNode?.parent) return null;
    this.currentNode = this.currentNode.parent;
    this.dump('goBack');
    return this.currentNode;
  }

  getForwardOptions(): NavNode[] {
    if (!this.currentNode) return [];
    return this.currentNode.children;
  }

  goForward(index: number): NavNode | null {
    const children = this.getForwardOptions();
    if (index < 0 || index >= children.length) return null;
    this.currentNode = children[index];
    this.dump('goForward');
    return this.currentNode;
  }

  private pruneIfExceeded(): void {
    if (!this.root) return;
    while (this.calcDepth(this.root) > this.maxDepth) {
      const leaves: NavNode[] = [];
      this.collectLeaves(this.root, leaves);
      leaves.sort((a, b) => a.timestamp - b.timestamp);
      const target = leaves[0];
      if (!target.parent) break;
      const idx = target.parent.children.indexOf(target);
      if (idx !== -1) target.parent.children.splice(idx, 1);
    }
  }

  removeNode(target: NavNode): void {
    if (target === this.root) {
      this.root = null;
      this.currentNode = null;
      return;
    }
    if (target.parent) {
      const idx = target.parent.children.indexOf(target);
      if (idx !== -1) target.parent.children.splice(idx, 1);
    }
    let node: NavNode | null = this.currentNode;
    while (node) {
      if (node === target) {
        this.currentNode = target.parent;
        return;
      }
      node = node.parent;
    }
    this.dump('removeNode');
  }

  private calcDepth(node: NavNode): number {
    let max = 0;
    for (const child of node.children) {
      max = Math.max(max, this.calcDepth(child) + 1);
    }
    return max;
  }

  private collectLeaves(node: NavNode, leaves: NavNode[]): void {
    if (node.children.length === 0) {
      leaves.push(node);
    } else {
      for (const child of node.children) {
        this.collectLeaves(child, leaves);
      }
    }
  }

  /**
   * 输出整棵树的当前形态到日志，便于调试。
   * operation 参数标识触发本次输出的操作。
   */
  dump(operation: string): void {
    console.log(`[Backtrace] ═══ TREE after ${operation} ═══`);
    console.log(`[Backtrace]   currentNode: ${this.currentNode?.symbolName || '(null)'}`);
    if (!this.root) {
      console.log('[Backtrace]   (empty)');
      return;
    }
    this._dumpNode(this.root, '  ');
    console.log('[Backtrace] ════════════════');
  }

  private _dumpNode(node: NavNode, indent: string): void {
    const fileName = (node.uri || '').split('/').pop() || (node.uri || '').split('\\').pop() || '';
    const label = node.contextName || node.symbolName || '(root)';
    const marker = node === this.currentNode ? ' <─ current' : '';
    console.log(
      `[Backtrace] ${indent}├─ ${label} @ ${fileName}:${node.line} (${node.children.length} children)${marker}`,
    );
    for (const child of node.children) {
      this._dumpNode(child, indent + '  ');
    }
  }

  serialize(): SerializedTree {
    const nodeList: NavNode[] = [];
    const indexMap = new Map<NavNode, number>();
    const queue: NavNode[] = [];
    if (this.root) queue.push(this.root);
    while (queue.length > 0) {
      const node = queue.shift()!;
      indexMap.set(node, nodeList.length);
      nodeList.push(node);
      for (const child of node.children) queue.push(child);
    }
    const serializedNodes: SerializedNavNode[] = nodeList.map((node) => ({
      uri: node.uri,
      line: node.line,
      column: node.column,
      symbolName: node.symbolName,
      contextName: node.contextName,
      timestamp: node.timestamp,
      parentIndex: node.parent ? (indexMap.get(node.parent) ?? null) : null,
      childrenIndices: node.children.map((c) => indexMap.get(c)).filter((i): i is number => i !== undefined),
      callerUri: node.callerUri ?? null,
      callerLine: node.callerLine ?? null,
      callerColumn: node.callerColumn ?? null,
      // stale 省略时就是 undefined，JSON 里直接没这个键，省空间；
      // 读回时用 ?? false 兜底（见 deserialize）。
      stale: node.stale ?? false,
    }));
    return {
      nodes: serializedNodes,
      currentNodeIndex: this.currentNode ? (indexMap.get(this.currentNode) ?? null) : null,
      maxDepth: this.maxDepth,
    };
  }

  deserialize(data: SerializedTree): void {
    if (!data.nodes || data.nodes.length === 0) return;
    const reconstructed: NavNode[] = data.nodes.map((sn) => ({
      uri: sn.uri,
      line: sn.line,
      column: sn.column,
      symbolName: sn.symbolName,
      contextName: sn.contextName || '',
      timestamp: sn.timestamp,
      children: [],
      parent: null,
      // 旧持久化数据没有 caller* 字段 → ?? null 兜底，UI 不显示调用行
      callerUri: sn.callerUri ?? null,
      callerLine: sn.callerLine ?? null,
      callerColumn: sn.callerColumn ?? null,
      // 更老的数据没有 stale 字段 → ?? false 兜底，默认"没过期"
      stale: sn.stale ?? false,
    }));
    for (let i = 0; i < data.nodes.length; i++) {
      const sn = data.nodes[i];
      const node = reconstructed[i];
      if (sn.parentIndex !== null && reconstructed[sn.parentIndex]) {
        node.parent = reconstructed[sn.parentIndex];
      }
      for (const ci of sn.childrenIndices) {
        if (reconstructed[ci]) node.children.push(reconstructed[ci]);
      }
    }
    this.root = reconstructed.length > 0 ? reconstructed[0] : null;
    this.currentNode =
      data.currentNodeIndex !== null && reconstructed[data.currentNodeIndex]
        ? reconstructed[data.currentNodeIndex]
        : this.root;
  }
}
