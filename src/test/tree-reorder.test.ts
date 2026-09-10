/// <reference types="mocha" />
/// <reference types="node" />

/**
 * 兄弟节点调序（行内 ↑/↓ 按钮）的单测。
 *
 * 只测 moveSibling 纯树操作。注意：换父的拖拽功能已下线，
 * 相关代码（moveNode / isDescendantOf / tree-drag-controller）连同
 * 单测一起删掉了，完整版留档在 backup/drag-attempt 分支。
 *
 * 序列化往返：children 数组顺序（即前进 QuickPick 的展示顺序）不丢。
 *
 * 造树小技巧：addJump 永远挂在 currentNode 下，所以
 * addJump → goBack → addJump 就能造出兄弟节点。
 */

import * as assert from 'assert';
import { NavTree } from '../nav-tree';

/**
 * 造一棵固定形状的树并返回各节点引用：
 *   root
 *   ├── b
 *   │   └── d
 *   └── c
 * 调用后 currentNode 停在 c。
 */
function buildTree(): NavTree {
  const tree = new NavTree(50);
  tree.addJump('root.ts', 1, 1, 'root');
  tree.addJump('b.ts', 2, 1, 'b');
  tree.addJump('d.ts', 4, 1, 'd');
  tree.goBack(); // 回到 b
  tree.goBack(); // 回到 root
  tree.addJump('c.ts', 3, 1, 'c');
  return tree;
}

suite('moveSibling', () => {
  test('moves a node up among siblings', () => {
    const tree = buildTree();
    const c = tree.root!.children[1];
    assert.strictEqual(tree.moveSibling(c, -1), true);
    assert.deepStrictEqual(
      tree.root!.children.map((n) => n.symbolName),
      ['c', 'b'],
    );
  });

  test('moves a node down among siblings', () => {
    const tree = buildTree();
    const b = tree.root!.children[0];
    assert.strictEqual(tree.moveSibling(b, 1), true);
    assert.deepStrictEqual(
      tree.root!.children.map((n) => n.symbolName),
      ['c', 'b'],
    );
  });

  test('refuses at the boundaries', () => {
    const tree = buildTree();
    const b = tree.root!.children[0];
    const c = tree.root!.children[1];
    // b 已在最上还上移、c 已在最下还下移 → false，命令层负责提示
    assert.strictEqual(tree.moveSibling(b, -1), false);
    assert.strictEqual(tree.moveSibling(c, 1), false);
    // 结构没变
    assert.deepStrictEqual(
      tree.root!.children.map((n) => n.symbolName),
      ['b', 'c'],
    );
  });

  test('refuses for the root (no siblings)', () => {
    const tree = buildTree();
    assert.strictEqual(tree.moveSibling(tree.root!, -1), false);
    assert.strictEqual(tree.moveSibling(tree.root!, 1), false);
  });
});

suite('reorder persistence', () => {
  test('serialize round-trip preserves the new order', () => {
    const tree = buildTree();
    const c = tree.root!.children[1];
    // 调序后存盘读回：顺序（= 前进 QuickPick 展示顺序）不丢
    tree.moveSibling(c, -1);
    const tree2 = new NavTree(50);
    tree2.deserialize(tree.serialize());
    assert.deepStrictEqual(
      tree2.root!.children.map((n) => n.symbolName),
      ['c', 'b'],
    );
  });
});
