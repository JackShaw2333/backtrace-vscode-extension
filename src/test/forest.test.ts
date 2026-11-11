/// <reference types="mocha" />
/// <reference types="node" />

import * as assert from 'assert';
import { NavTree } from '../nav-tree';
import { SerializedTree } from '../nav-node';

/**
 * 多根森林的单元测试。
 *
 * 只依赖 NavTree（不 import vscode），可以直接用裸 mocha 运行，
 * 不需要 Extension Host。
 */
suite('NavTree forest', () => {
  test('addRoot appends a manual root and activates it', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    const root = tree.addRoot('ctrl.ts', 10, 1, 'getUser', 'UserController');

    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(tree.root, root);
    assert.strictEqual(tree.currentNode, root);
    assert.strictEqual(root.parent, null);
    assert.strictEqual(root.kind, 'manual');
    assert.strictEqual(root.callerUri, null);
    assert.strictEqual(tree.roots[0].kind, 'implicit');
  });

  test('addJump after addRoot attaches under the new root, not the old tree', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    const root = tree.addRoot('ctrl.ts', 10, 1, 'getUser', 'UserController');
    tree.addJump('svc.ts', 20, 1, 'getUser', 'UserService');

    assert.strictEqual(root.children.length, 1);
    assert.strictEqual(root.children[0].symbolName, 'getUser');
    assert.strictEqual(tree.roots[0].children.length, 0);
  });

  test('addJump falls back to the active root when currentNode is null', () => {
    const tree = new NavTree(50);
    tree.addRoot('r1.ts', 1, 1, 'r1');
    const r2 = tree.addRoot('r2.ts', 2, 1, 'r2');
    tree.currentNode = null;

    const node = tree.addJump('x.ts', 3, 1, 'x');
    assert.strictEqual(node.parent, r2);
    assert.strictEqual(r2.children.length, 1);
  });

  test('promoteToRoot detaches node and its subtree into a new root', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.addJump('c.ts', 3, 1, 'c');
    const b = tree.roots[0].children[0];

    assert.strictEqual(tree.promoteToRoot(b), true);
    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(b.parent, null);
    assert.strictEqual(b.children.length, 1);
    assert.strictEqual(b.children[0].symbolName, 'c');
    assert.strictEqual(tree.roots[0].children.length, 0);
    assert.strictEqual(b.callerUri, null);
    assert.strictEqual(b.kind, 'manual');
    assert.strictEqual(tree.root, b);
    // currentNode 在被提升的子树内（c），保持不动；活动根跟随到 b。
    assert.strictEqual(tree.currentNode?.symbolName, 'c');
    assert.strictEqual(tree.rootOf(tree.currentNode!), b);
  });

  test('promoteToRoot returns false for a node that is already a root', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    assert.strictEqual(tree.promoteToRoot(tree.roots[0]), false);
    assert.strictEqual(tree.roots.length, 1);
  });

  test('promoteToRoot re-anchors currentNode when it is outside the promoted subtree', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    const b = tree.roots[0].children[0];
    tree.goBack(); // current 回到 a
    assert.strictEqual(tree.currentNode?.symbolName, 'a');

    tree.promoteToRoot(b);
    assert.strictEqual(tree.currentNode, b);
  });

  test('promoteToRoot works for a leaf', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    const b = tree.roots[0].children[0];

    assert.strictEqual(tree.promoteToRoot(b), true);
    assert.strictEqual(b.children.length, 0);
    assert.strictEqual(tree.roots[0].children.length, 0);
  });

  test('removeNode on the active root falls back to a surviving root', () => {
    const tree = new NavTree(50);
    const r1 = tree.addRoot('r1.ts', 1, 1, 'r1');
    const r2 = tree.addRoot('r2.ts', 2, 1, 'r2');
    assert.strictEqual(tree.root, r2);

    tree.removeNode(r2);
    assert.strictEqual(tree.roots.length, 1);
    assert.strictEqual(tree.root, r1);
    assert.strictEqual(tree.currentNode, r1);
  });

  test('removeNode on the last root empties the forest', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.removeNode(tree.roots[0]);

    assert.strictEqual(tree.roots.length, 0);
    assert.strictEqual(tree.root, null);
    assert.strictEqual(tree.currentNode, null);
    assert.strictEqual(tree.isEmpty, true);
  });

  test('removeNode on a non-active root keeps current and active root', () => {
    const tree = new NavTree(50);
    const r1 = tree.addRoot('r1.ts', 1, 1, 'r1');
    const r2 = tree.addRoot('r2.ts', 2, 1, 'r2');
    assert.strictEqual(tree.setActiveRoot(r1), true);
    tree.currentNode = r1;

    tree.removeNode(r2);
    assert.strictEqual(tree.roots.length, 1);
    assert.strictEqual(tree.root, r1);
    assert.strictEqual(tree.currentNode, r1);
  });

  test('setActiveRoot rejects nodes that are not roots', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    assert.strictEqual(tree.setActiveRoot(tree.roots[0].children[0]), false);
    assert.strictEqual(tree.root, tree.roots[0]);
  });

  test('serialize and deserialize round-trips a multi-root forest', () => {
    const tree = new NavTree(50);
    const r1 = tree.addRoot('a.ts', 1, 1, 'a');
    r1.label = 'Root A';
    tree.addJump('b.ts', 2, 1, 'b');
    tree.addRoot('c.ts', 3, 1, 'c');
    tree.addJump('d.ts', 4, 1, 'd');
    tree.currentNode = tree.roots[0].children[0]; // b
    tree.setActiveRoot(r1);

    const serialized = tree.serialize();
    assert.strictEqual(serialized.version, 2);
    // 根按 _roots 顺序先入队，所以根索引是 [0, 1]（不是 BFS 里的任意位置）。
    assert.deepStrictEqual(serialized.roots, [0, 1]);
    assert.strictEqual(serialized.activeRootIndex, 0);

    const restored = new NavTree(50);
    restored.deserialize(serialized);
    assert.strictEqual(restored.roots.length, 2);
    assert.strictEqual(restored.roots[0].label, 'Root A');
    assert.strictEqual(restored.roots[0].kind, 'manual');
    assert.strictEqual(restored.roots[1].symbolName, 'c');
    assert.strictEqual(restored.currentNode?.symbolName, 'b');
    assert.strictEqual(restored.root, restored.roots[0]);
    assert.strictEqual(restored.roots[0].children[0].symbolName, 'b');
  });

  test('deserialize migrates v1 single-root data', () => {
    const legacy: SerializedTree = {
      nodes: [
        {
          uri: 'a.ts',
          line: 1,
          column: 1,
          symbolName: 'a',
          contextName: '',
          parentIndex: null,
          childrenIndices: [1],
          timestamp: 0,
        },
        {
          uri: 'b.ts',
          line: 2,
          column: 1,
          symbolName: 'b',
          contextName: '',
          parentIndex: 0,
          childrenIndices: [],
          timestamp: 1,
        },
      ],
      currentNodeIndex: 1,
      maxDepth: 50,
    };

    const tree = new NavTree(50);
    tree.deserialize(legacy);
    assert.strictEqual(tree.roots.length, 1);
    assert.strictEqual(tree.root?.symbolName, 'a');
    assert.strictEqual(tree.currentNode?.symbolName, 'b');
    assert.strictEqual(tree.rootOf(tree.currentNode!), tree.roots[0]);
  });

  test('deserialize derives roots from parentless nodes when roots is missing', () => {
    // v1 数据里恰好有两个 parentless 节点（非法但应容错）→ 两个根。
    const data: SerializedTree = {
      nodes: [
        {
          uri: 'a.ts',
          line: 1,
          column: 1,
          symbolName: 'a',
          contextName: '',
          parentIndex: null,
          childrenIndices: [],
          timestamp: 0,
        },
        {
          uri: 'b.ts',
          line: 2,
          column: 1,
          symbolName: 'b',
          contextName: '',
          parentIndex: null,
          childrenIndices: [],
          timestamp: 1,
        },
      ],
      currentNodeIndex: null,
      maxDepth: 50,
    };
    const tree = new NavTree(50);
    tree.deserialize(data);
    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(tree.root?.symbolName, 'a');
  });

  test('deserialize with empty payload clears an existing forest', () => {
    const tree = new NavTree(50);
    tree.addRoot('a.ts', 1, 1, 'a');
    tree.deserialize({ nodes: [], currentNodeIndex: null, maxDepth: 50 });
    assert.strictEqual(tree.isEmpty, true);
    assert.strictEqual(tree.root, null);
    assert.strictEqual(tree.currentNode, null);
  });

  test('deserialize falls back to nodes[0] for corrupted data without parentless node', () => {
    const data: SerializedTree = {
      nodes: [
        {
          uri: 'a.ts',
          line: 1,
          column: 1,
          symbolName: 'a',
          contextName: '',
          parentIndex: 1,
          childrenIndices: [],
          timestamp: 0,
        },
        {
          uri: 'b.ts',
          line: 2,
          column: 1,
          symbolName: 'b',
          contextName: '',
          parentIndex: 0,
          childrenIndices: [],
          timestamp: 1,
        },
      ],
      currentNodeIndex: null,
      maxDepth: 50,
    };
    const tree = new NavTree(50);
    tree.deserialize(data);
    assert.strictEqual(tree.roots.length, 1);
    assert.strictEqual(tree.root?.symbolName, 'a');
    assert.strictEqual(tree.root?.parent, null);
  });

  test('prune runs per root and never deletes a root', () => {
    const tree = new NavTree(2);
    const r1 = tree.addRoot('r1.ts', 1, 1, 'r1');
    tree.addJump('c1.ts', 1, 1, 'c1'); // depth 1
    tree.addJump('c2.ts', 1, 1, 'c2'); // depth 2
    tree.addJump('c3.ts', 1, 1, 'c3'); // depth 3 → 触发裁剪

    const r2 = tree.addRoot('r2.ts', 1, 1, 'r2');
    tree.addJump('d1.ts', 1, 1, 'd1');

    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(tree.roots[0], r1);
    // r1 被裁到深度 2：r1 → c1 → c2（最旧的叶子 c3 被删）
    assert.strictEqual(r1.children.length, 1);
    assert.strictEqual(r1.children[0].symbolName, 'c1');
    assert.strictEqual(r1.children[0].children.length, 1);
    assert.strictEqual(r1.children[0].children[0].symbolName, 'c2');
    // r2 完全不受影响
    assert.strictEqual(tree.roots[1], r2);
    assert.strictEqual(r2.children.length, 1);
  });

  test('removing a root after the active root keeps the active root invariant', () => {
    const tree = new NavTree(50);
    const a = tree.addRoot('a.ts', 1, 1, 'a');
    tree.addRoot('b.ts', 2, 1, 'b');
    tree.addRoot('c.ts', 3, 1, 'c');
    tree.setActiveRoot(a);
    tree.currentNode = a;

    tree.removeNode(tree.roots[1]); // 删 b（在活动根之后）
    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(tree.root, a);
    assert.strictEqual(tree.currentNode, a);
    assert.strictEqual(tree.activeRootIndex, 0);
    assert.strictEqual(tree.rootOf(tree.currentNode!), tree.root);
  });

  test('removing the active root falls back to a surviving root', () => {
    const tree = new NavTree(50);
    tree.addRoot('a.ts', 1, 1, 'a');
    const b = tree.addRoot('b.ts', 2, 1, 'b');
    tree.addRoot('c.ts', 3, 1, 'c');
    assert.strictEqual(tree.setActiveRoot(b), true);
    tree.currentNode = b;

    tree.removeNode(b);
    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(tree.currentNode, tree.root);
    assert.strictEqual(tree.rootOf(tree.currentNode!), tree.root);
  });

  test('removing an earlier root keeps the active root on the same tree', () => {
    const tree = new NavTree(50);
    const a = tree.addRoot('a.ts', 1, 1, 'a');
    tree.addRoot('b.ts', 2, 1, 'b');
    const c = tree.addRoot('c.ts', 3, 1, 'c');
    tree.setActiveRoot(c);
    tree.currentNode = c;

    tree.removeNode(a); // 删第一个根（在活动根之前）
    assert.strictEqual(tree.roots.length, 2);
    assert.strictEqual(tree.root, c);
    assert.strictEqual(tree.currentNode, c);
    assert.strictEqual(tree.activeRootIndex, 1);
  });

  test('rootOf terminates on a corrupted parent cycle', () => {
    const tree = new NavTree(50);
    const a = tree.addJump('a.ts', 1, 1, 'a');
    const b = tree.addJump('b.ts', 2, 1, 'b');
    // 人为制造 a ↔ b 的 parent 环（模拟损坏的持久化数据）。
    a.parent = b;
    b.parent = a;
    assert.strictEqual(tree.rootOf(a), a);
    assert.strictEqual(tree.rootOf(b), b);
  });

  test('normalize re-anchors current and active root after external mutation', () => {
    const tree = new NavTree(50);
    const a = tree.addRoot('a.ts', 1, 1, 'a');
    tree.addRoot('b.ts', 2, 1, 'b');
    tree.setActiveRoot(a);
    tree.currentNode = null;
    tree.normalize();
    assert.strictEqual(tree.currentNode, a);
    assert.strictEqual(tree.root, a);
  });
});
