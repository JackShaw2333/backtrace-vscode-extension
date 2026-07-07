/**
 * 导航树的数据类型定义。
 *
 * 这个文件只定义数据的"形状"（接口），不包含任何逻辑。
 * "export" 让其他文件可以 import 这些类型。
 * "interface" 是 TypeScript 用来描述对象结构的方式。
 */

/** 导航树中的一个节点 */
export interface NavNode {
    uri: string;            // 文件路径，例如 "file:///c:/project/app.ts"
    line: number;           // 行号（从 1 开始）
    column: number;         // 列号（从 1 开始）
    symbolName: string;     // 光标处的符号名，例如 "handleClick"
    children: NavNode[];    // 子节点列表（A→B 时 B 是 A 的子节点）
    parent: NavNode | null; // 父节点。根节点为 null
    timestamp: number;      // 创建时间戳（毫秒），用于裁剪旧节点
}

/** 序列化用的节点——用索引代替指针，避免 JSON.stringify 报循环引用错误 */
export interface SerializedNavNode {
    uri: string;
    line: number;
    column: number;
    symbolName: string;
    parentIndex: number | null;   // 父节点在数组中的索引，根节点为 null
    childrenIndices: number[];    // 子节点们在数组中的索引列表
    timestamp: number;
}

/** 序列化后的整棵树 */
export interface SerializedTree {
    nodes: SerializedNavNode[];
    currentNodeIndex: number | null;  // 当前节点在数组中的位置
    maxDepth: number;
}
