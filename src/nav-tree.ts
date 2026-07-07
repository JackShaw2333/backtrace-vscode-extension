/**
 * 导航树数据结构。
 *
 * 管理一棵"跳转树"：每次用户 F12/Ctrl+Click 跳转到一个新位置，
 * 就向树上加一个节点。树的结构示例：
 *
 *   A（第一次跳转，成为树根）
 *   ├── B（从A跳到了B）
 *   │   └── C（从B跳到了C）
 *   └── D（回到A后，又从A跳到了D）
 *
 * "后退" = 沿 parent 向上，"前进" = 沿 children 向下。
 * 多子节点时弹出选择框让用户选。
 */

import { NavNode, SerializedNavNode, SerializedTree } from './nav-node';

/**
 * NavTree 类。
 * root = 树根节点；currentNode = 当前所在位置。
 * 不加修饰符的属性（如 root、currentNode）默认是 public。
 */
export class NavTree {
    /** 树的根节点，没有历史时为 null */
    root: NavNode | null = null;
    /** 当前所在节点，后退/前进就是改变这个指针 */
    currentNode: NavNode | null = null;
    /** 树的最大深度，可在设置中调整 */
    maxDepth: number;

    /** 构造函数。maxDepth 默认值 50，不传参数时自动使用 */
    constructor(maxDepth: number = 50) {
        this.maxDepth = maxDepth;
    }

    /**
     * 记录一次跳转：创建新节点，加到当前节点的子节点列表。
     * @param uri 目标文件 URI
     * @param line 目标行号
     * @param column 目标列号
     * @param symbolName 目标位置的符号名
     * @returns 新创建的 NavNode
     */
    addJump(uri: string, line: number, column: number, symbolName: string): NavNode {
        // 创建新节点。children 初始为空数组，parent 设 null（稍后挂到树上再设置）
        const node: NavNode = {
            uri,
            line,
            column,
            symbolName,
            children: [],
            parent: null,
            timestamp: Date.now(),
        };

        if (!this.root) {
            // 树是空的 → 让这个节点成为树根
            this.root = node;
            this.currentNode = node;
        } else if (this.currentNode) {
            // 树非空 → 把新节点挂到 currentNode 下面
            node.parent = this.currentNode;
            this.currentNode.children.push(node);
            this.currentNode = node;
        }

        this.pruneIfExceeded(); // 检查是否超深
        return node;
    }

    /**
     * 后退：沿 parent 链向上走一步。
     * "?." 是可选链，如果 currentNode 或 parent 为 null，直接返回 null。
     * @returns 后退到的节点，或 null（已在树根）
     */
    goBack(): NavNode | null {
        if (!this.currentNode?.parent) return null;
        this.currentNode = this.currentNode.parent;
        return this.currentNode;
    }

    /**
     * 获取前进选项。
     * 有父节点时返回"兄弟节点排除自己"（即其他分支选项）；
     * 是根节点时返回子节点。
     * .filter() 是数组方法，返回满足条件的新数组。
     */
    getForwardOptions(): NavNode[] {
        if (!this.currentNode) return [];
        if (this.currentNode.parent) {
            return this.currentNode.parent.children.filter(c => c !== this.currentNode);
        }
        return this.currentNode.children;
    }

    /**
     * 前进到指定索引的位置。
     * @param index getForwardOptions() 结果中的位置
     * @returns 前进到的节点，或 null（索引无效）
     */
    goForward(index: number): NavNode | null {
        const children = this.getForwardOptions();
        if (index < 0 || index >= children.length) return null;
        this.currentNode = children[index];
        return this.currentNode;
    }

    // ── 私有方法 ──────────────────────────────────────────

    /** 超出最大深度时，删除最旧的叶子节点（没有子节点的节点） */
    private pruneIfExceeded(): void {
        if (!this.root) return;
        const depth = this.calcDepth(this.root);
        if (depth <= this.maxDepth) return;

        // 收集所有叶子，按时间戳升序排序，删除最早的
        const leaves: NavNode[] = [];
        this.collectLeaves(this.root, leaves);
        leaves.sort((a, b) => a.timestamp - b.timestamp);
        const target = leaves[0];
        if (target.parent) {
            const idx = target.parent.children.indexOf(target);
            if (idx !== -1) target.parent.children.splice(idx, 1);
        }
    }

    /** 递归计算节点深度。递归 = 函数调用自己 */
    private calcDepth(node: NavNode): number {
        let max = 0;
        for (const child of node.children) {
            max = Math.max(max, this.calcDepth(child) + 1);
        }
        return max;
    }

    /** 递归收集所有叶子节点 */
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
     * 把树序列化为扁平的可 JSON 化结构。
     * 因为 NavNode 有 parent/children 循环引用，
     * JSON.stringify 会报错，所以用 BFS 遍历 + 索引代替指针。
     * BFS = 广度优先搜索，用队列实现（先进先出）。
     * @returns 可安全 JSON.stringify 的 SerializedTree
     */
    serialize(): SerializedTree {
        const nodeList: NavNode[] = [];
        const indexMap = new Map<NavNode, number>(); // 节点 → 数组索引

        const queue: NavNode[] = [];
        if (this.root) queue.push(this.root);

        while (queue.length > 0) {
            const node = queue.shift()!; // ! 是非空断言
            indexMap.set(node, nodeList.length);
            nodeList.push(node);
            for (const child of node.children) {
                queue.push(child);
            }
        }

        // .map() 对数组每个元素执行回调，返回新数组
        // ?? 是空值合并：左边不是 null/undefined 就用左边，否则右边
        const serializedNodes: SerializedNavNode[] = nodeList.map((node) => ({
            uri: node.uri,
            line: node.line,
            column: node.column,
            symbolName: node.symbolName,
            timestamp: node.timestamp,
            parentIndex: node.parent ? indexMap.get(node.parent) ?? null : null,
            childrenIndices: node.children.map((c) => indexMap.get(c)!).filter((i) => i !== undefined),
        }));

        return {
            nodes: serializedNodes,
            currentNodeIndex: this.currentNode ? indexMap.get(this.currentNode) ?? null : null,
            maxDepth: this.maxDepth,
        };
    }

    /** 从序列化数据恢复树结构。先建节点再连 parent/children 指针 */
    deserialize(data: SerializedTree): void {
        if (!data.nodes || data.nodes.length === 0) return;

        // 第一步：重建节点（parent/children 暂时为空）
        const reconstructed: NavNode[] = data.nodes.map((sn) => ({
            uri: sn.uri,
            line: sn.line,
            column: sn.column,
            symbolName: sn.symbolName,
            timestamp: sn.timestamp,
            children: [],
            parent: null,
        }));

        // 第二步：根据索引重建链接关系
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
