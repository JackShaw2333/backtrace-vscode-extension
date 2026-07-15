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
   */
  addJump(uri: string, line: number, column: number, symbolName: string, contextName: string = ''): NavNode {
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
    };

    if (!this.root) {
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
    return node;
  }

  goBack(): NavNode | null {
    if (!this.currentNode?.parent) return null;
    this.currentNode = this.currentNode.parent;
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
