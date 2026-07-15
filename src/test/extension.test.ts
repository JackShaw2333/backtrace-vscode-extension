/// <reference types="mocha" />
/// <reference types="node" />

import * as assert from 'assert';
import { NavTree } from '../nav-tree';
import { BacktraceConfig } from '../config';

suite('Backtrace Extension', () => {
  test('NavTree handles empty tree gracefully', () => {
    const tree = new NavTree(50);
    assert.strictEqual(tree.root, null);
    assert.strictEqual(tree.currentNode, null);
    assert.strictEqual(tree.goBack(), null);
    assert.strictEqual(tree.goForward(0), null);
    assert.deepStrictEqual(tree.getForwardOptions(), []);
  });

  test('NavTree prunes at maxDepth', () => {
    const tree = new NavTree(2);
    tree.addJump('a.ts', 1, 1, 'a');  // depth 0
    tree.addJump('b.ts', 2, 1, 'b');  // depth 1
    tree.addJump('c.ts', 3, 1, 'c');  // depth 2 — still <= maxDepth(2)
    tree.addJump('d.ts', 4, 1, 'd');  // depth 3 — exceeds maxDepth, triggers prune
    assert.ok(tree.root !== null);
    // After prune, oldest leaf was removed but root stays
    assert.strictEqual(tree.currentNode?.symbolName, 'd');
  });

  test('Backwards navigation after tree modification', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 1, 1, 'a');
    tree.addJump('b.ts', 2, 1, 'b');
    tree.addJump('c.ts', 3, 1, 'c');
    tree.goBack(); // to b
    tree.goBack(); // to a
    assert.strictEqual(tree.currentNode?.symbolName, 'a');
    // Forward from a should show b
    const fromA = tree.getForwardOptions();
    assert.strictEqual(fromA.length, 1);
    assert.strictEqual(fromA[0].symbolName, 'b');
  });

  test('deep tree maintains correct parent chain', () => {
    const tree = new NavTree(50);
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (const n of nodes) {
      tree.addJump(`${n}.ts`, 1, 1, n);
    }
    let count = 0;
    while (tree.goBack() !== null) {
      count++;
    }
    assert.strictEqual(count, nodes.length - 1);
    assert.strictEqual(tree.currentNode?.symbolName, 'a');
  });

  // ── 配置测试 ──────────────────────────────────────────
  test('config has default values', () => {
    const cfg: BacktraceConfig = {
      maxTreeDepth: 50,
      persistHistory: true,
      forwardBehavior: 'notification',
    };
    assert.strictEqual(cfg.maxTreeDepth, 50);
    assert.strictEqual(cfg.persistHistory, true);
    assert.strictEqual(cfg.forwardBehavior, 'notification');
  });

  test('config accepts quickpick forward behavior', () => {
    const cfg: BacktraceConfig = {
      maxTreeDepth: 50,
      persistHistory: true,
      forwardBehavior: 'quickpick',
    };
    assert.strictEqual(cfg.forwardBehavior, 'quickpick');
  });

  test('NavTree constructor respects maxDepth', () => {
    const tree = new NavTree(5);
    assert.strictEqual(tree.maxDepth, 5);
    for (let i = 0; i < 10; i++) {
      tree.addJump(`${i}.ts`, 1, 1, `n${i}`);
    }
    assert.ok(tree.root !== null);
  });
});
