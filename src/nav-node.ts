export interface NavNode {
    uri: string;
    line: number;
    column: number;
    symbolName: string;
    children: NavNode[];
    parent: NavNode | null;
    timestamp: number;
}

/** Serialized form with index references instead of parent/children pointers */
export interface SerializedNavNode {
    uri: string;
    line: number;
    column: number;
    symbolName: string;
    parentIndex: number | null;   // index into serialized array
    childrenIndices: number[];    // indices into serialized array
    timestamp: number;
}

export interface SerializedTree {
    nodes: SerializedNavNode[];
    currentNodeIndex: number | null;
    maxDepth: number;
}
