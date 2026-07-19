/**
 * 导航树的数据类型定义。
 *
 * 这个文件只定义数据的"形状"（interface），不包含任何逻辑。
 * interface（接口）是 TypeScript 特有的概念，编译后不生成任何代码，
 * 只用于在开发时做类型检查——相当于给数据加了一个"模板"。
 *
 * 为什么用 interface 而不是 class？
 *   我们只需要描述数据结构，不需要方法。
 *   interface 比 class 轻量，编译后零开销。
 */

/**
 * NavNode ── 导航树中的一个节点。
 *
 * 每次用户从 A 跳到 B，我们就创建一个 NavNode 记录 B 的位置信息，
 * 然后把它挂在 A 节点的 children 列表里。
 */
export interface NavNode {
  /**
   * 文件 URI。
   * 为什么不用文件路径字符串？VSCode 的文件定位 API 都要求 URI 格式。
   * 例如：file:///c:/project/src/app.ts
   */
  uri: string;

  /**
   * 行号（从 1 开始）。
   * 为什么不是从 0 开始？人类的直觉是"第一行"= 行号 1。
   * VSCode 内部用的是 0-based，但我们存的时候 +1，
   * 在跳转时 -1 还原。
   */
  line: number;

  /** 列号（从 1 开始）。和行号一样的原因 */
  column: number;

  /**
   * 光标处的符号名。
   * 例如函数名 "handleClick"、变量名 "count"。
   * 用于在 UI 中显示"你跳转到了哪里"。
   * 获取方式：document.getWordRangeAtPosition() + getText()。
   */
  symbolName: string;

  /**
   * 所在的函数/方法/类上下文路径。
   * 例如 "AppComponent.ngOnInit" 表示在 AppComponent 的 ngOnInit 方法中。
   * 通过 vscode.executeDocumentSymbolProvider 获取。
   * 如果获取失败则为空字符串。
   */
  contextName: string;

  /**
   * 子节点列表。
   * NavNode[] 是 TypeScript 数组类型，表示"由 NavNode 组成的数组"。
   * 为什么是数组？一个节点可能跳到多个不同的位置（例如从 A 跳到 B，
   * 回到 A 后，又从 A 跳到 C），所以需要多个子节点。
   */
  children: NavNode[];

  /**
   * 父节点。
   * "NavNode | null" 是 TypeScript 的联合类型，表示"要么是 NavNode，要么是 null"。
   * 为什么可能为 null？根节点没有父节点。
   * 没有循环引用的问题吗？有，所以序列化时需要用索引代替指针。
   */
  parent: NavNode | null;

  /**
   * 创建时间戳（毫秒）。
   * 为什么用 number 而不是 Date 或 string？
   *   - Date 对象不能直接 JSON.stringify
   *   - 字符串不易做数学比较（排序、差值计算）
   *   - number 方便：排序叶子节点时直接 a.timestamp - b.timestamp
   * 为什么需要这个字段？深度裁剪时删掉最旧的叶子节点。
   */
  timestamp: number;

  /**
   * 调用者位置 —— 该节点是从父节点的哪个位置跳转过来的。
   *
   * 为什么需要这个字段？
   *   父节点只记录了"跳转到的目标位置"（即父节点自身的 line/column），
   *   但一个函数会调用许多子函数。当用户从 A.ts:50 用 F12 跳到 B.ts:20 时，
   *   A 节点的 line 可能是 10（A 函数定义的起始位置），
   *   而真正的调用点 A.ts:50 会丢失。
   *   保存 callerPosition 后，新按钮"跳转到调用位置"可以把光标精确
   *   送回到 A.ts:50，而不是 A 函数的初始位置 A.ts:10。
   *
   * 为什么是可选的（| null）？
   *   - 根节点没有调用者 → null
   *   - 旧持久化数据反序列化后无此字段 → null
   *   UI 仅在该字段非空时显示调用行后缀和跳转按钮。
   */
  callerUri?: string | null;
  callerLine?: number | null;
  callerColumn?: number | null;
}

/**
 * SerializedNavNode ── 序列化用的节点。
 *
 * 为什么需要这个"序列化版本"？
 *
 * 问题：JSON.stringify 无法处理循环引用。
 * NavNode 有 parent 和 children 属性，它们互相引用：
 *   父节点.children → 子节点
 *   子节点.parent → 父节点
 * 这种关系在内存中没问题，但 JSON.stringify 会抛异常：
 *   "Converting circular structure to JSON"
 *
 * 解决方案：序列化时断开循环引用。
 * SerializedNavNode 把 parent 和 children 替换为索引值。
 * - parentIndex：父节点在数组中的位置
 * - childrenIndices：子节点们在数组中的位置列表
 */
export interface SerializedNavNode {
  uri: string;
  line: number;
  column: number;
  symbolName: string;
  contextName: string;

  /**
   * 父节点在数组中的索引。
   * 为什么是 number | null？根节点没有父节点，索引为 null。
   * 为什么用索引而不是字符串指向？数组索引查找是 O(1) 常数时间。
   */
  parentIndex: number | null;

  /**
   * 子节点们在数组中的索引列表。
   * number[] 表示"由数字组成的数组"。
   * 如果节点没有子节点，这是一个空数组 []。
   */
  childrenIndices: number[];

  timestamp: number;

  /**
   * 调用者位置（序列化版本）。
   * 详见 NavNode.callerUri 的说明。
   * 用 string | null / number | null 兼容旧数据：
   *   旧 SerializedNavNode 没有这些字段 → deserialize 时用 ?? null 兜底。
   */
  callerUri?: string | null;
  callerLine?: number | null;
  callerColumn?: number | null;
}

/**
 * SerializedTree ── 序列化后的整棵树。
 *
 * 根节点总是 nodes[0]（BFS 遍历的第一个节点）。
 * 为什么用数组而不是直接存根节点？
 *   数组可以顺序遍历，方便重建 parent/children 指针。
 *
 * 这个结构可以直接 JSON.stringify 保存到 VSCode 的 globalState 中。
 */
export interface SerializedTree {
  /** 所有节点的扁平数组（BFS 顺序） */
  nodes: SerializedNavNode[];

  /**
   * 当前节点在数组中的索引。
   * 为什么需要这个？恢复时需要知道用户上次退出时在树的哪个位置。
   * 为什么可能为 null？空树时没有当前节点。
   */
  currentNodeIndex: number | null;

  /** 树的最大深度限制（来自用户设置） */
  maxDepth: number;
}
