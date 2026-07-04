import { NavNode, SerializedNavNode, SerializedTree } from './nav-node';

export class NavTree {
    root: NavNode | null = null;
    currentNode: NavNode | null = null;
    maxDepth: number;

    constructor(maxDepth: number = 50) {
        this.maxDepth = maxDepth;
    }

    /** Create a new node and add it as a child of currentNode (or set as root if empty) */
    addJump(uri: string, line: number, column: number, symbolName: string): NavNode {
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
            this.root = node;
            this.currentNode = node;
        } else if (this.currentNode) {
            node.parent = this.currentNode;
            this.currentNode.children.push(node);
            this.currentNode = node;
        }

        this.pruneIfExceeded();
        return node;
    }

    /** Move currentNode to its parent. Returns the target node, or null if already at root. */
    goBack(): NavNode | null {
        if (!this.currentNode?.parent) return null;
        this.currentNode = this.currentNode.parent;
        return this.currentNode;
    }

    /** Get the list of forward navigation options (siblings from parent context) */
    getForwardOptions(): NavNode[] {
        if (!this.currentNode) return [];
        if (this.currentNode.parent) {
            return this.currentNode.parent.children;
        }
        return this.currentNode.children;
    }

    /** Navigate to the child at the given index. Returns the target node, or null if invalid. */
    goForward(index: number): NavNode | null {
        const children = this.getForwardOptions();
        if (index < 0 || index >= children.length) return null;
        this.currentNode = children[index];
        return this.currentNode;
    }

    /** Remove the deepest oldest leaf branches when depth exceeds maxDepth */
    private pruneIfExceeded(): void {
        if (!this.root) return;
        const depth = this.calcDepth(this.root);
        if (depth <= this.maxDepth) return;

        const leaves: NavNode[] = [];
        this.collectLeaves(this.root, leaves);
        leaves.sort((a, b) => a.timestamp - b.timestamp);
        const target = leaves[0];
        if (target.parent) {
            const idx = target.parent.children.indexOf(target);
            if (idx !== -1) target.parent.children.splice(idx, 1);
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

    /** Serialize tree to a flat structure safe for JSON (no circular refs) */
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
            parentIndex: node.parent ? indexMap.get(node.parent) ?? null : null,
            childrenIndices: node.children.map((c) => indexMap.get(c)!).filter((i) => i !== undefined),
        }));

        return {
            nodes: serializedNodes,
            currentNodeIndex: this.currentNode ? indexMap.get(this.currentNode) ?? null : null,
            maxDepth: this.maxDepth,
        };
    }

    /** Restore tree from a serialized structure */
    deserialize(data: SerializedTree): void {
        if (!data.nodes || data.nodes.length === 0) return;

        const reconstructed: NavNode[] = data.nodes.map((sn) => ({
            uri: sn.uri,
            line: sn.line,
            column: sn.column,
            symbolName: sn.symbolName,
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
                if (reconstructed[ci]) {
                    node.children.push(reconstructed[ci]);
                }
            }
        }

        this.root = reconstructed.length > 0 ? reconstructed[0] : null;
        this.currentNode = (data.currentNodeIndex !== null && reconstructed[data.currentNodeIndex])
            ? reconstructed[data.currentNodeIndex]
            : this.root;
    }
}
