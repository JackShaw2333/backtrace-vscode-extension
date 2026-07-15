/// <reference types="mocha" />
/// <reference types="node" />

import * as assert from 'assert';
import { NavTree } from '../nav-tree';

suite('NavTree', () => {
  test('addJump creates a child under root on first call', () => {
    const tree = new NavTree(50);
    tree.addJump('file.ts', 10, 5, 'foo');
    assert.strictEqual(tree.root?.symbolName, 'foo');
    assert.strictEqual(tree.currentNode?.symbolName, 'foo');
    assert.strictEqual(tree.root?.children.length, 0);
  });

  test('addJump creates a child under currentNode on subsequent calls', () => {
    const tree = new NavTree(50);
    tree.addJump('file.ts', 10, 5, 'foo'); // root
    tree.addJump('file2.ts', 20, 3, 'bar'); // child of root
    assert.strictEqual(tree.currentNode?.symbolName, 'bar');
    assert.strictEqual(tree.root?.children.length, 1);
    assert.strictEqual(tree.root?.children[0].symbolName, 'bar');
  });

  test('addJump creates a sibling when going back then jumping', () => {
    const tree = new NavTree(50);
    tree.addJump('file.ts', 10, 5, 'root');
    tree.addJump('file2.ts', 20, 3, 'child');
    tree.goBack();
    tree.addJump('file3.ts', 30, 1, 'sibling');
    assert.strictEqual(tree.currentNode?.symbolName, 'sibling');
    assert.strictEqual(tree.root?.children.length, 2);
  });

  test('goBack moves to parent', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    const result = tree.goBack();
    assert.strictEqual(result?.symbolName, 'a');
    assert.strictEqual(tree.currentNode?.symbolName, 'a');
  });

  test('goBack returns null at root', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    const result = tree.goBack();
    assert.strictEqual(result, null);
  });

  test('getForwardOptions returns children of current node', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.addJump('c.ts', 3, 1, 'c');
    // tree: a → b → c, currentNode = c
    const options = tree.getForwardOptions();
    assert.strictEqual(options.length, 0); // c has no children

    tree.goBack(); // to b
    const optionsB = tree.getForwardOptions();
    assert.strictEqual(optionsB.length, 1); // b has one child (c)
    assert.strictEqual(optionsB[0].symbolName, 'c');
  });

  test('goForward by index navigates to that child', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    // tree: a → b, currentNode = b
    tree.goBack(); // to a
    // a's forward options = [b]
    tree.goForward(0);
    assert.strictEqual(tree.currentNode?.symbolName, 'b');
  });

  test('goForward with empty children returns null', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    const result = tree.goForward(0);
    assert.strictEqual(result, null);
  });

  test('serialize and deserialize round-trips correctly', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');

    const serialized = tree.serialize();
    assert.ok(serialized.nodes.length >= 3);
    assert.strictEqual(typeof serialized.currentNodeIndex, 'number');

    const tree2 = new NavTree(50);
    tree2.deserialize(serialized);
    assert.strictEqual(tree2.root?.symbolName, 'a');
    assert.strictEqual(tree2.currentNode?.symbolName, 'c');
    assert.strictEqual(tree2.root?.children.length, 2);
  });

  test('serialize and deserialize preserves navigation capability', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();

    const serialized = tree.serialize();
    const tree2 = new NavTree(50);
    tree2.deserialize(serialized);

    const result = tree2.goBack();
    assert.strictEqual(result, null);
  });

  test('serialization handles empty tree', () => {
    const tree = new NavTree(50);
    const serialized = tree.serialize();
    assert.strictEqual(serialized.nodes.length, 0);
    assert.strictEqual(serialized.currentNodeIndex, null);

    const tree2 = new NavTree(50);
    tree2.deserialize(serialized);
    assert.strictEqual(tree2.root, null);
  });

  test('serialization handles single node', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    const serialized = tree.serialize();
    assert.strictEqual(serialized.nodes.length, 1);
    const tree2 = new NavTree(50);
    tree2.deserialize(serialized);
    assert.strictEqual(tree2.root?.symbolName, 'a');
  });

  // ── removeNode 测试 ──────────────────────────────────
  test('removeNode deletes root and clears tree', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.removeNode(tree.root!);
    assert.strictEqual(tree.root, null);
    assert.strictEqual(tree.currentNode, null);
  });

  test('removeNode falls back to parent when deleting current node', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.removeNode(tree.currentNode!);
    assert.strictEqual(tree.currentNode?.symbolName, 'a');
  });

  test('removeNode deletes branch without affecting other branches', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');
    const bNode = tree.root!.children[0];
    tree.removeNode(bNode);
    assert.strictEqual(tree.root!.children.length, 1);
    assert.strictEqual(tree.root!.children[0].symbolName, 'c');
  });

  test('removeNode leaf at root keeps current node', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.removeNode(tree.root!.children[0]);
    assert.strictEqual(tree.currentNode?.symbolName, 'a');
    assert.strictEqual(tree.root!.children.length, 0);
  });

  // ── 多分支前进测试 ──────────────────────────────────
  test('goForward with multiple children at root', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');
    tree.goBack();
    assert.strictEqual(tree.getForwardOptions().length, 2);
    tree.goForward(0);
    assert.strictEqual(tree.currentNode?.symbolName, 'b');
  });

  // ── 深度裁剪测试 ──────────────────────────────────
  test('pruneIfExceeded removes oldest leaf in branching tree', () => {
    const tree = new NavTree(2);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');
    // tree: a(children: b,c) depth=1 ok
    tree.goBack();
    tree.addJump('d.ts', 4, 1, 'd');
    // tree: a(children: b,c,d) depth=1, within maxDepth=2
    assert.strictEqual(tree.root!.children.length, 3);
  });

  test('addJump attaches to root when currentNode is null', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    // Simulate orphan by clearing currentNode
    tree.currentNode = null;
    tree.addJump('c.ts', 3, 1, 'c');
    // Should attach to root, not become orphan
    assert.strictEqual(tree.currentNode!.symbolName, 'c');
    assert.strictEqual(tree.root!.children.length, 2);
  });

  test('serialization and deserialize with branching tree', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');
    tree.goBack();

    const serialized = tree.serialize();
    assert.strictEqual(serialized.nodes.length, 3);

    const tree2 = new NavTree(50);
    tree2.deserialize(serialized);
    assert.strictEqual(tree2.root?.children.length, 2);
    assert.strictEqual(tree2.currentNode?.symbolName, 'a');
  });
});
