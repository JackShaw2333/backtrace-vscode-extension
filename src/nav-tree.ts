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
 *
 * 为什么属性不加 private？
 *   因为没有写修饰符（如 root、currentNode）默认是 public，
 *   其他文件（如 TreeDataProvider）需要直接读取它们来渲染界面。
 */
export class NavTree {
  // ── 公开属性（外部可读写）──────────────────────────────
  /**
   * 树的根节点。
   * 为什么初始是 null？因为刚打开 VSCode 时还没有任何导航历史，
   * 用户第一次跳转后才创建根节点。
   * 为什么是 public？TreeDataProvider 需要读取它来显示整棵树。
   */
  root: NavNode | null = null;

  /**
   * 当前所在的节点。
   * 为什么需要这个属性？后退/前进本质就是改变这个指针的值。
   * 为什么可能为 null？树为空的时候（还没有任何跳转记录）。
   */
  currentNode: NavNode | null = null;

  /**
   * 树的最大深度（由用户设置控制）。
   * 为什么需要限制深度？防止导航分支太多撑爆内存。
   * 用户可以在 VSCode 设置中修改 backtrace.maxTreeDepth。
   */
  maxDepth: number;

  // ── 构造函数 ──────────────────────────────────────────
  /**
   * @param maxDepth 默认值 50。不传参时自动用 50，这是 ES6 的"默认参数"语法。
   *   为什么默认 50？一般用户的单次探索深度很少超过 50 步。
   */
  constructor(maxDepth: number = 50) {
    this.maxDepth = maxDepth;
  }

  // ── 核心方法 ──────────────────────────────────────────

  /**
   * 记录一次跳转：创建一个新节点，加到当前节点的子节点列表中。
   *
   * @param uri        目标文件的 URI（例如 "file:///c:/project/app.ts"）
   * @param line       目标行号（从 1 开始）
   * @param column     目标列号（从 1 开始）
   * @param symbolName 目标位置的符号名（函数名/变量名等）
   * @returns 新创建的 NavNode
   */
  addJump(uri: string, line: number, column: number, symbolName: string): NavNode {
    // 为什么用对象字面量创建？NavNode 是 interface（接口），不是 class，
    // TypeScript 中 interface 只能用字面量或工厂函数创建。
    const node: NavNode = {
      uri,
      line,
      column,
      symbolName,
      children: [], // 新节点还没有子节点，先给空数组
      parent: null, // 还不确定父节点是谁，稍后设置
      timestamp: Date.now(),
    };

    if (!this.root) {
      // 树是空的 → 这个节点就是树根
      // 为什么用 if (!this.root) 判断？因为 root 是 NavNode | null，
      // JavaScript 中 null 转布尔值是 false，!false = true
      this.root = node;
      this.currentNode = node;
    } else if (this.currentNode) {
      // 树非空 → 挂在 currentNode 下面
      // 为什么用 .push()？因为 children 是数组，push 是数组方法
      node.parent = this.currentNode;
      this.currentNode.children.push(node);
      // 把"当前节点"更新为新节点
      this.currentNode = node;
    }

    this.pruneIfExceeded(); // 加完节点后检查深度
    return node;
  }

  /**
   * 后退一步：从当前节点回到它的父节点。
   *
   * "?." 是 TypeScript 的可选链操作符（ES2020 引入）：
   *   如果 this.currentNode 是 null，表达式直接返回 undefined，不会报错。
   *   等价于：if (this.currentNode === null || this.currentNode.parent === null)
   *
   * @returns 后退到的节点，或 null（已在树根）
   */
  goBack(): NavNode | null {
    if (!this.currentNode?.parent) return null;
    this.currentNode = this.currentNode.parent;
    return this.currentNode;
  }

  /**
   * 获取当前节点的子节点列表（前进目标）。
   *
   * 为什么返回子节点而不是父节点的其他子节点（兄弟）？
   *   "前进"的语义是"向更深层导航"，逻辑上应该进入子节点。
   *   如果需要切换到同层其他分支，可以通过树视图直接点击。
   *
   * 如果当前节点是树根：返回根的直接子节点。
   * 如果当前节点没有子节点：返回空数组。
   */
  getForwardOptions(): NavNode[] {
    if (!this.currentNode) return [];
    return this.currentNode.children;
  }

  /**
   * 前进到指定索引的位置。
   *
   * @param index getForwardOptions() 返回的数组中的位置
   * @returns 前进到的节点，或 null（索引无效）
   */
  goForward(index: number): NavNode | null {
    const children = this.getForwardOptions();
    if (index < 0 || index >= children.length) return null;
    this.currentNode = children[index];
    return this.currentNode;
  }

  // ── 私有方法（仅类内部使用）─────────────────────────
  // 为什么用 private？这些是实现细节，外部不需要知道。

  /**
   * 超出最大深度时，删除时间戳最旧的叶子节点。
   *
   * 为什么只删叶子？删非叶子节点会丢失整个子树的历史。
   * 为什么删最旧的？先发生的导航信息价值相对较低。
   */
  private pruneIfExceeded(): void {
    if (!this.root) return;
    const depth = this.calcDepth(this.root);
    if (depth <= this.maxDepth) return;

    // 收集所有叶子，按时间戳从旧到新排序
    const leaves: NavNode[] = [];
    this.collectLeaves(this.root, leaves);
    leaves.sort((a, b) => a.timestamp - b.timestamp);
    const target = leaves[0];
    if (target.parent) {
      // .indexOf() 在数组中查找目标的位置
      // .splice(idx, 1) 从数组删除一个元素
      const idx = target.parent.children.indexOf(target);
      if (idx !== -1) target.parent.children.splice(idx, 1);
    }
  }

  /**
   * 删除一个节点及其所有子节点（整个子树）。
   *
   * 为什么需要这个方法？用户可以在右键菜单中删除不需要的导航记录。
   *
   * 删除后 currentNode 的处理：
   *   - 如果删除的是 currentNode 本身或其子节点 → currentNode 上移一层
   *   - 如果删除的是其他分支 → currentNode 不变
   *
   * @param target 要删除的节点
   */
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
    // 如果当前节点是被删除节点或其后代 → 回退到父节点
    let node: NavNode | null = this.currentNode;
    while (node) {
      if (node === target) {
        this.currentNode = target.parent;
        return;
      }
      node = node.parent;
    }
  }

  /**
   * 递归计算节点深度。
   * 为什么用递归？树的结构天然适合递归（每个子树都是一棵树）。
   * 没有子节点的节点深度为 0。
   */
  private calcDepth(node: NavNode): number {
    let max = 0;
    for (const child of node.children) {
      max = Math.max(max, this.calcDepth(child) + 1);
    }
    return max;
  }

  /** 递归收集所有叶子节点到数组中 */
  private collectLeaves(node: NavNode, leaves: NavNode[]): void {
    if (node.children.length === 0) {
      leaves.push(node);
    } else {
      for (const child of node.children) {
        this.collectLeaves(child, leaves);
      }
    }
  }

  // ── 序列化与反序列化 ──────────────────────────────────

  /**
   * 把树序列化为可 JSON 化的扁平结构。
   *
   * 为什么需要序列化？
   *   1. VSCode 的 globalState 只接受可 JSON.stringify 的数据
   *   2. NavNode 有 parent/children 循环引用，JSON.stringify 会报错：
   *      "Converting circular structure to JSON"
   *
   * 如何解决？
   *   BFS（广度优先搜索）遍历树，把节点放进数组，
   *   用数组索引代替 parent/children 指针。
   *
   * "!" 是非空断言，告诉 TypeScript"这个值不可能是 undefined"。
   * "??" 是空值合并操作符，左边不是 null/undefined 就用左边。
   * ".map()" 对数组每个元素执行函数，返回新数组。
   */
  serialize(): SerializedTree {
    const nodeList: NavNode[] = [];
    const indexMap = new Map<NavNode, number>();

    const queue: NavNode[] = [];
    if (this.root) queue.push(this.root);

    while (queue.length > 0) {
      const node = queue.shift()!;
      indexMap.set(node, nodeList.length);
      nodeList.push(node);
      for (const child of node.children) {
        queue.push(child);
      }
    }

    const serializedNodes: SerializedNavNode[] = nodeList.map((node) => ({
      uri: node.uri,
      line: node.line,
      column: node.column,
      symbolName: node.symbolName,
      timestamp: node.timestamp,
      parentIndex: node.parent ? (indexMap.get(node.parent) ?? null) : null,
      childrenIndices: node.children.map((c) => indexMap.get(c)!).filter((i) => i !== undefined),
    }));

    return {
      nodes: serializedNodes,
      currentNodeIndex: this.currentNode ? (indexMap.get(this.currentNode) ?? null) : null,
      maxDepth: this.maxDepth,
    };
  }

  /** 从序列化数据恢复树：先建节点列表，再连 parent/children 指针 */
  deserialize(data: SerializedTree): void {
    if (!data.nodes || data.nodes.length === 0) return;

    // 第一步：从 SerializedNavNode 重建 NavNode（parent/children 暂时为空）
    const reconstructed: NavNode[] = data.nodes.map((sn) => ({
      uri: sn.uri,
      line: sn.line,
      column: sn.column,
      symbolName: sn.symbolName,
      timestamp: sn.timestamp,
      children: [],
      parent: null,
    }));

    // 第二步：根据索引把 parent/children 指针连起来
    for (let i = 0; i < data.nodes.length; i++) {
      const sn = data.nodes[i];
      const node = reconstructed[i];
      if (sn.parentIndex !== null && reconstructed[sn.parentIndex]) {
        node.parent = reconstructed[sn.parentIndex];
      }
      for (const ci of sn.childrenIndices) {
        if (reconstructed[ci]) {
          node.children.push(reconstructed[ci]);
        }
      }
    }

    // 第三步：设置 root 和 currentNode
    this.root = reconstructed.length > 0 ? reconstructed[0] : null;
    this.currentNode =
      data.currentNodeIndex !== null && reconstructed[data.currentNodeIndex]
        ? reconstructed[data.currentNodeIndex]
        : this.root;
  }
}
