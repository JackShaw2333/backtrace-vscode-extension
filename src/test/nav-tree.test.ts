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

  test('getForwardOptions returns siblings excluding current node', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');
    const options = tree.getForwardOptions();
    assert.strictEqual(options.length, 1);
    assert.strictEqual(options[0].symbolName, 'b');
  });

  test('goForward by index navigates to that child', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.goBack();
    tree.addJump('c.ts', 3, 1, 'c');
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
});
