/**
 * 导航树数据结构。
 *
 * 记录用户的导航历史，组织成**森林（forest）**：
 * 每棵树有一个根，根是用户指定的探索起点（或首次跳转的隐式落点）。
 *
 *   Root A（UserController#getUser）
 *   ├── UserService#getUser
 *   │   └── UserRepository#findById
 *   └── UserService#validate
 *
 *   Root B（OrderController#pay）
 *   └── PayService#pay
 *
 * 为什么需要多根？
 *   Spring Boot 这类框架把“框架入口 → 业务方法”的连接藏了起来：
 *   跳转历史天然只能从 controller 方法开始，写不到 main()。允许用户
 *   自建根，就能把每条探索链的起点显式标出来，而不是让系统猜入口。
 *
 * “后退”沿 parent 向上走，“前进”沿 children 向下走；
 * 根与根之间互相独立，通过底部面板点击切换活动根。
 *
 * 结构调整只有两种（都刻意保持很小）：
 *   - moveSibling：同一父节点下调整兄弟顺序（只改数组顺序）；
 *   - promoteToRoot：把节点及其子树整体提升为新根（换父是伪需求，
 *     人为改父等于伪造调用路径，已明确不做）。
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
 * NavTree 类 = 整片导航森林。
 *
 * 内部用 _roots 数组保存所有根（数组顺序 = 面板展示顺序），
 * _activeRootIndex 指向“活动根”。对外的 root 是**只读 getter**，
 * 由 _roots + _activeRootIndex 派生——单一数据源，避免根字段和
 * 根数组不同步。
 */
export class NavTree {
  /** 所有根节点（数组顺序 = 面板展示顺序 + 序列化顺序）。 */
  private _roots: NavNode[] = [];

  /** 活动根在 _roots 中的下标（normalize/setActiveRoot 负责维护）。 */
  private _activeRootIndex = 0;

  /** 当前节点。跨根点击时由调用方直接赋值，normalize 会跟随其根。 */
  currentNode: NavNode | null = null;

  maxDepth: number;

  constructor(maxDepth: number = 50) {
    this.maxDepth = maxDepth;
  }

  /** 只读视图：所有根。 */
  get roots(): readonly NavNode[] {
    return this._roots;
  }

  /**
   * 活动根（兼容旧代码的 root 语义）。
   * 为什么保留它？扩展里 10 处外部读取原先都按“当前上下文”使用，
   * 保留 getter 后无需大改，也保住了现有 61 项测试。
   */
  get root(): NavNode | null {
    return this._roots[this._activeRootIndex] ?? null;
  }

  /** 活动根（新代码请用这个更明确的名字）。 */
  get activeRoot(): NavNode | null {
    return this.root;
  }

  /** 活动根下标（调试/序列化用）。 */
  get activeRootIndex(): number {
    return this._activeRootIndex;
  }

  /** 森林是否为空（替代原先的 !tree.root 判定）。 */
  get isEmpty(): boolean {
    return this._roots.length === 0;
  }

  /** 沿 parent 链找到 node 所属的根；node 为 null 时返回 null。 */
  rootOf(node: NavNode | null): NavNode | null {
    let cur = node;
    while (cur && cur.parent) {
      cur = cur.parent;
    }
    return cur;
  }

  /** 把某个根设为活动根；不是根返回 false。 */
  setActiveRoot(root: NavNode): boolean {
    const index = this._roots.indexOf(root);
    if (index === -1) {
      return false;
    }
    this._activeRootIndex = index;
    return true;
  }

  /**
   * 记录一次跳转。
   *
   * 三种情况（保持旧行为的向后兼容）：
   *   1. 森林为空 → 本次跳转落点成为第一个根（隐式根，kind='implicit'）；
   *   2. currentNode 非空 → 挂到 currentNode 下（与旧版完全一致）；
   *   3. currentNode 为 null → 挂到活动根下（旧版是“挂到 root”，多根下
   *      自然推广为“挂到活动根”）。
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
      label: null,
    };

    if (this._roots.length === 0) {
      // 根节点没有调用者：即使 callerPosition 被传入也强制清空，
      // 避免误把首次跳转前的位置当作"调用点"。
      node.callerUri = null;
      node.callerLine = null;
      node.callerColumn = null;
      node.kind = 'implicit';
      this._roots.push(node);
      this._activeRootIndex = 0;
      this.currentNode = node;
    } else {
      // currentNode 正常应属于森林；若它已因 prune/旧数据脱树，
      // 回退到活动根，避免把新节点挂到一个不可达的幽灵节点下。
      const fallbackParent = this.currentNode && this.isInForest(this.currentNode) ? this.currentNode : null;
      const parent = fallbackParent ?? this.root ?? this._roots[0];
      node.parent = parent;
      parent.children.push(node);
      this.currentNode = node;
      const parentRoot = this.rootOf(parent);
      const rootIndex = parentRoot ? this._roots.indexOf(parentRoot) : -1;
      if (rootIndex !== -1) {
        this._activeRootIndex = rootIndex;
      }
    }

    this.pruneIfExceeded();
    this.dump('addJump');
    return node;
  }

  /**
   * 用户显式建根（光标处建根）。
   *
   * 与 addJump 的首跳隐式建根区别：
   *   - 不依赖任何跳转，随时可调用；
   *   - kind 记为 'manual'，UI 可区分“自动根”和“用户根”；
   *   - 无调用者（caller* 全为 null）。
   *
   * 新根追加到 _roots 末尾，并立即成为活动根 + currentNode，
   * 这样面板 reveal 和新跳转都落在这棵新树上。
   */
  addRoot(
    uri: string,
    line: number,
    column: number,
    symbolName: string,
    contextName: string = '',
    label: string | null = null,
  ): NavNode {
    const node: NavNode = {
      uri,
      line,
      column,
      symbolName,
      contextName,
      children: [],
      parent: null,
      timestamp: Date.now(),
      callerUri: null,
      callerLine: null,
      callerColumn: null,
      label,
      kind: 'manual',
    };
    this._roots.push(node);
    this._activeRootIndex = this._roots.length - 1;
    this.currentNode = node;
    this.dump('addRoot');
    return node;
  }

  /**
   * 把已有节点及其整棵子树提升为新根（“单独建根”）。
   *
   * 做法：从原父的 children 摘出 → parent = null → push 进 _roots。
   * 子树原样保留，原父只是少了这一支；“提升”后该节点就是根，
   * 因此清空 caller*（根没有“从哪跳来”的语义，和 addJump 建根一致）。
   *
   * 为什么不支持“换父到任意节点”？
   *   节点树是探索过程自然生成的，parent 记录的语义是“我当时从哪
   *   跳过来”。人为换父等于伪造调用路径，是伪需求，已明确不做。
   *
   * @returns true = 真提升了；false = 它本来就是根（no-op）
   */
  promoteToRoot(node: NavNode): boolean {
    if (!node.parent) {
      return false;
    }
    const parent = node.parent;
    const index = parent.children.indexOf(node);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    node.parent = null;
    // 根没有调用者：保持“根 caller 恒为 null”的不变量。
    node.callerUri = null;
    node.callerLine = null;
    node.callerColumn = null;
    node.kind = 'manual';
    this._roots.push(node);
    this._activeRootIndex = this._roots.length - 1;
    // 如果 current 不在被提升的子树里，把 current 移到新根，
    // 否则侧边栏/面板的活动上下文还停在旧树，用户会困惑。
    if (!this.currentNode || !this.isAncestorOrSelf(node, this.currentNode)) {
      this.currentNode = node;
    }
    this.dump('promoteToRoot');
    return true;
  }

  /** 后退：沿 parent 向上走一步；已在根上返回 null。 */
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
    const targetRoot = this.rootOf(this.currentNode);
    const rootIndex = targetRoot ? this._roots.indexOf(targetRoot) : -1;
    if (rootIndex !== -1) {
      this._activeRootIndex = rootIndex;
    }
    this.dump('goForward');
    return this.currentNode;
  }

  /**
   * 收敛所有派生状态，保证不变量：
   *   - 森林空 → currentNode null、活动根下标 0；
   *   - currentNode 在森林内 → 活动根 = currentNode 所在的根；
   *   - currentNode 为空或脱树 → 回退到活动根（再不行回退 roots[0]）。
   *
   * 所有结构变更（建根/提升/删除/反序列化）末尾都应调用它。
   */
  normalize(): void {
    if (this._roots.length === 0) {
      this.currentNode = null;
      this._activeRootIndex = 0;
      return;
    }
    const currentRoot = this.rootOf(this.currentNode);
    const index = currentRoot ? this._roots.indexOf(currentRoot) : -1;
    if (index !== -1) {
      this._activeRootIndex = index;
    }
    if (this._activeRootIndex < 0 || this._activeRootIndex >= this._roots.length) {
      this._activeRootIndex = 0;
    }
    if (!this.currentNode || index === -1) {
      this.currentNode = this._roots[this._activeRootIndex] ?? this._roots[0] ?? null;
    }
  }

  /**
   * 深度裁剪：逐棵树独立判断，超过 maxDepth 就删该树最旧的叶子。
   *
   * 与旧版的区别：
   *   - 旧版只裁 root 那一棵，其它根无限增长；
   *   - 旧版可能把“根自身”当叶子删掉，这里显式排除根——根本身
   *     是用户锚点，永不自动删除（哪怕它暂时没有子节点）。
   */
  private pruneIfExceeded(): void {
    if (this._roots.length === 0) return;
    for (const root of this._roots) {
      while (this.calcDepth(root) > this.maxDepth) {
        const leaves: NavNode[] = [];
        this.collectLeaves(root, leaves);
        // 过滤掉根：单节点根无法再裁，直接放弃这棵树。
        const removable = leaves.filter((leaf) => leaf !== root);
        if (removable.length === 0) break;
        removable.sort((a, b) => a.timestamp - b.timestamp);
        const target = removable[0];
        const parent = target.parent;
        if (!parent) break;
        const idx = parent.children.indexOf(target);
        if (idx !== -1) {
          parent.children.splice(idx, 1);
          // 被裁掉的正好是 current 时回退到父节点：否则 currentNode
          // 会指向已脱离森林的幽灵节点，serialize 丢 currentNodeIndex、
          // 侧边栏显示不在树里的路径。
          if (target === this.currentNode) {
            this.currentNode = parent;
          }
        }
      }
    }
  }

  /**
   * 从森林中删除节点及其所有子节点。
   *
   * 两种形态：
   *   - 目标是根 → 整棵树删除；若当前节点在这棵树里，回退到相邻根
   *     （没有其它根就清空）；活动根下标收敛；
   *   - 目标是普通节点 → 只删这一支，若 current 在其中则回退到父节点。
   */
  removeNode(target: NavNode): void {
    const rootIndex = this._roots.indexOf(target);
    if (rootIndex !== -1) {
      this._roots.splice(rootIndex, 1);
      if (this._roots.length === 0) {
        this._activeRootIndex = 0;
        this.currentNode = null;
        this.dump('removeNode');
        return;
      }
      this._activeRootIndex = Math.min(rootIndex, this._roots.length - 1);
      if (this.currentNode && this.isAncestorOrSelf(target, this.currentNode)) {
        this.currentNode = this._roots[this._activeRootIndex] ?? this._roots[0] ?? null;
      }
      this.dump('removeNode');
      return;
    }
    if (target.parent) {
      const idx = target.parent.children.indexOf(target);
      if (idx !== -1) {
        target.parent.children.splice(idx, 1);
      }
    }
    let node: NavNode | null = this.currentNode;
    while (node) {
      if (node === target) {
        this.currentNode = target.parent;
        this.dump('removeNode');
        return;
      }
      node = node.parent;
    }
    this.dump('removeNode');
  }

  /**
   * 在兄弟中上移 / 下移一位（行内 ↑/↓ 按钮用）。
   *
   * 只改 parent.children 数组里的顺序，不改 parent 指针。
   * 顺序的意义：goForward 多分支 QuickPick 按数组顺序列出，
   * 所以调序 = 调整前进选项的展示顺序。
   *
   * 注意：这里只做兄弟调序，不做跨父搬家——换父是伪需求已明确不做；
   * 把节点单独拆出去请用 promoteToRoot。
   *
   * @param direction -1 = 上移（往数组头），+1 = 下移（往数组尾）
   * @returns true = 真动了；false = 到顶/到底或无父（根），调用方提示即可
   */
  moveSibling(node: NavNode, direction: -1 | 1): boolean {
    if (!node.parent) {
      return false;
    }
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    const swapWith = idx + direction;
    // 越界 = 已在最上/最下，无事发生（提示文案由命令层负责）。
    if (idx === -1 || swapWith < 0 || swapWith >= siblings.length) {
      return false;
    }
    siblings[idx] = siblings[swapWith];
    siblings[swapWith] = node;
    this.dump('moveSibling');
    return true;
  }

  private isInForest(node: NavNode): boolean {
    const root = this.rootOf(node);
    return root !== null && this._roots.indexOf(root) !== -1;
  }

  /** node 是否是 ancestor 本身或其子孙（沿 parent 链上溯）。 */
  private isAncestorOrSelf(ancestor: NavNode, node: NavNode): boolean {
    let cur: NavNode | null = node;
    while (cur) {
      if (cur === ancestor) return true;
      cur = cur.parent;
    }
    return false;
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
   * 输出整片森林的当前形态到日志，便于调试。
   * operation 参数标识触发本次输出的操作。
   */
  dump(operation: string): void {
    console.log(`[Backtrace] ═══ TREE after ${operation} ═══`);
    console.log(`[Backtrace]   currentNode: ${this.currentNode?.contextName || this.currentNode?.symbolName || '(null)'}`);
    if (this._roots.length === 0) {
      console.log('[Backtrace]   (empty)');
      console.log('[Backtrace] ════════════════');
      return;
    }
    this._roots.forEach((root, index) => {
      const marker = index === this._activeRootIndex ? '*' : '';
      this._dumpNode(root, `  [root ${index}${marker}] `);
    });
    console.log('[Backtrace] ════════════════');
  }

  private _dumpNode(node: NavNode, indent: string): void {
    const fileName = (node.uri || '').split('/').pop() || (node.uri || '').split('\\').pop() || '';
    const label = node.label || node.contextName || node.symbolName || '(root)';
    const marker = node === this.currentNode ? ' <─ current' : '';
    console.log(
      `[Backtrace] ${indent}├─ ${label} @ ${fileName}:${node.line} (${node.children.length} children)${marker}`,
    );
    for (const child of node.children) {
      this._dumpNode(child, indent + '  ');
    }
  }

  /**
   * 序列化为 v2 结构（多根森林）。
   *
   * BFS 队列先塞入所有根（按 _roots 顺序），再逐层展开：
   * 这样 nodes[0..roots.length-1] 恰好是各个根，旧版本读新数据时
   * 至少能把第一棵树完整读出来，不会崩。
   */
  serialize(): SerializedTree {
    const nodeList: NavNode[] = [];
    const indexMap = new Map<NavNode, number>();
    const queue: NavNode[] = [];
    for (const root of this._roots) {
      queue.push(root);
    }
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
      // label 只有重命名过的根才有值，其余节点写 null 也行（可读性一致）。
      label: node.label ?? null,
      kind: node.kind,
    }));
    return {
      version: 2,
      roots: this._roots.map((root) => indexMap.get(root)).filter((i): i is number => i !== undefined),
      activeRootIndex: this._activeRootIndex,
      nodes: serializedNodes,
      currentNodeIndex: this.currentNode ? (indexMap.get(this.currentNode) ?? null) : null,
      maxDepth: this.maxDepth,
    };
  }

  /**
   * 从持久化数据恢复（兼容 v1 单根数据）。
   *
   * 根集合的推导顺序：
   *   1. 有 roots 字段 → 用它（过滤越界/非法索引）；
   *   2. 所有 parentIndex === null 的节点一律补成根（v1 数据就只有
   *      nodes[0] 一个，天然兼容；也防御 roots 字段残缺）；
   *   3. 一个根都没有（数据损坏）→ 回退 nodes[0] 当根，不抛异常。
   *
   * 活动根优先由 currentNode 的祖先链推导：实际 current 比存档下标可信。
   */
  deserialize(data: SerializedTree): void {
    // 空数据必须显式清空：旧实现直接 return，会把已有森林残留在内存里。
    if (!data.nodes || data.nodes.length === 0) {
      this._roots = [];
      this._activeRootIndex = 0;
      this.currentNode = null;
      return;
    }
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
      label: sn.label ?? null,
      kind: sn.kind,
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

    // 根集合：优先用存档，再用 parentless 节点补齐。
    const rootIndices: number[] = [];
    if (data.roots && data.roots.length > 0) {
      for (const index of data.roots) {
        if (Number.isInteger(index) && index >= 0 && index < reconstructed.length && !rootIndices.includes(index)) {
          rootIndices.push(index);
        }
      }
    }
    for (let i = 0; i < data.nodes.length; i++) {
      if (data.nodes[i].parentIndex === null && !rootIndices.includes(i)) {
        rootIndices.push(i);
      }
    }
    if (rootIndices.length === 0) {
      rootIndices.push(0);
    }
    // 防御：roots 指定的节点如果还挂着 parent（数据不一致），就地断开，
    // 保证“根 parent 必为 null”的不变量。
    for (const index of rootIndices) {
      const node = reconstructed[index];
      if (node.parent) {
        const idx = node.parent.children.indexOf(node);
        if (idx !== -1) {
          node.parent.children.splice(idx, 1);
        }
        node.parent = null;
      }
    }
    this._roots = rootIndices.map((index) => reconstructed[index]);

    // currentNode：存档下标有效则用它，否则回退活动根。
    const storedCurrent =
      data.currentNodeIndex !== null && data.currentNodeIndex !== undefined
        ? reconstructed[data.currentNodeIndex] ?? null
        : null;
    const currentRoot = this.rootOf(storedCurrent);
    const currentRootIndex = currentRoot ? this._roots.indexOf(currentRoot) : -1;
    if (storedCurrent && currentRootIndex !== -1) {
      this.currentNode = storedCurrent;
      this._activeRootIndex = currentRootIndex;
    } else {
      const storedActive =
        data.activeRootIndex !== undefined &&
        data.activeRootIndex >= 0 &&
        data.activeRootIndex < this._roots.length
          ? data.activeRootIndex
          : 0;
      this._activeRootIndex = storedActive;
      this.currentNode = this._roots[this._activeRootIndex] ?? this._roots[0] ?? null;
    }
  }
}
