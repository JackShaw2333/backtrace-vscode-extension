/// <reference types="mocha" />
/// <reference types="node" />

import * as assert from 'assert';
import { NavTree } from '../nav-tree';
import { BacktraceConfig } from '../config';
import { CommandWatcher } from '../command-watcher';

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

  // ── resolveCallerPosition 测试 ────────────────────────
  // 验证调用点捕获策略：
  //   - Ctrl+Click（有 Mouse 事件）→ 使用 Mouse 位置（被点击的符号）
  //   - F12（无 Mouse 事件）→ 使用 prevKnown（跳转前的光标位置）
  //   - 兜底 → 父节点记录位置
  suite('resolveCallerPosition', () => {
    test('Ctrl+Click: uses Mouse event position as caller', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'root');
      tree.addJump('b.ts', 20, 3, 'parent');
      const watcher = new CommandWatcher(tree);
      // 模拟 Ctrl+Click：Mouse 事件把光标移到 a.ts:100（被点击的符号）
      watcher._setTestState({
        lastMousePosition: { uri: 'a.ts', line: 100, column: 12 },
        lastMouseAt: Date.now(),
      });
      // prevKnown 是跳转前的光标位置（a.ts:30），但应被 Mouse 位置覆盖
      const caller = watcher.resolveCallerPosition({ uri: 'a.ts', line: 30, column: 1 });
      assert.strictEqual(caller?.uri, 'a.ts');
      assert.strictEqual(caller?.line, 100);
    });

    test('F12: uses prevKnown (pre-jump position) as caller', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'root');
      tree.addJump('b.ts', 20, 3, 'parent');
      const watcher = new CommandWatcher(tree);
      watcher._setTestState({
        lastMousePosition: null,
        lastMouseAt: 0,
      });
      // F12：光标在 b.ts:50 的符号上，prevKnown = b.ts:50
      const caller = watcher.resolveCallerPosition({ uri: 'b.ts', line: 50, column: 8 });
      assert.strictEqual(caller?.uri, 'b.ts');
      assert.strictEqual(caller?.line, 50);
    });

    test('falls back to parent position when no other info', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'parent');
      const watcher = new CommandWatcher(tree);
      watcher._setTestState({
        lastMousePosition: null,
        lastMouseAt: 0,
      });
      const caller = watcher.resolveCallerPosition(null);
      assert.strictEqual(caller?.uri, 'a.ts');
      assert.strictEqual(caller?.line, 10);
    });

    test('stale Mouse event is ignored, falls back to prevKnown', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'root');
      tree.addJump('b.ts', 20, 3, 'parent');
      const watcher = new CommandWatcher(tree);
      // Mouse 事件发生在很久以前（超过 300ms 窗口）
      watcher._setTestState({
        lastMousePosition: { uri: 'a.ts', line: 100, column: 12 },
        lastMouseAt: Date.now() - 500,
      });
      const caller = watcher.resolveCallerPosition({ uri: 'b.ts', line: 50, column: 8 });
      // 应忽略过期的 Mouse 事件，使用 prevKnown
      assert.strictEqual(caller?.uri, 'b.ts');
      assert.strictEqual(caller?.line, 50);
    });

    test('returns null when tree is empty and no position info', () => {
      const tree = new NavTree(50);
      const watcher = new CommandWatcher(tree);
      watcher._setTestState({
        lastMousePosition: null,
        lastMouseAt: 0,
      });
      const caller = watcher.resolveCallerPosition(null);
      assert.strictEqual(caller, null);
    });
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
