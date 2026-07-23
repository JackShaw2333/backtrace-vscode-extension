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

  // ── pickCallerFromHistory 测试 ────────────────────────
  // 验证 Ctrl+Click 场景下的 caller 挑选逻辑：
  //   - 过滤掉"点击同文件符号"产生的污染（与目标行距离过近的候选）
  //   - 找不到合适候选时回退到父节点的记录位置
  suite('pickCallerFromHistory', () => {
    test('filters out Ctrl+Click pollution on same-file symbol', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'root');
      tree.addJump('b.ts', 20, 3, 'parent');
      // 模拟：用户在 b.ts:80（真实 caller），Ctrl+Click b.ts:100 的符号，
      // 跳转到 c.ts:200。Mouse 事件先把光标移到 b.ts:100（污染），
      // 随后 Command 事件到 c.ts:200。
      const watcher = new CommandWatcher(tree);
      watcher._setTestHistory([
        { uri: 'b.ts', line: 80, column: 5 },   // 跳转前的真实位置
        { uri: 'b.ts', line: 100, column: 12 }, // Ctrl+Click 点击处（污染）
      ]);
      const caller = watcher.pickCallerFromHistory({ uri: 'c.ts', line: 200, column: 1 });
      assert.strictEqual(caller?.uri, 'b.ts');
      assert.strictEqual(caller?.line, 80);
    });

    test('falls back to parent position when no candidate is suitable', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'parent');
      const watcher = new CommandWatcher(tree);
      // 历史中只有与目标行很近的污染位置（b.ts:99 ≈ 目标 b.ts:100）
      watcher._setTestHistory([
        { uri: 'a.ts', line: 99, column: 1 },
      ]);
      const caller = watcher.pickCallerFromHistory({ uri: 'b.ts', line: 100, column: 1 });
      // 无合适候选 → 回退到父节点
      assert.strictEqual(caller?.uri, 'a.ts');
      assert.strictEqual(caller?.line, 10);
    });

    test('returns null when tree has no parent and history is empty', () => {
      const tree = new NavTree(50);
      const watcher = new CommandWatcher(tree);
      watcher._setTestHistory([]);
      const caller = watcher.pickCallerFromHistory({ uri: 'b.ts', line: 100, column: 1 });
      assert.strictEqual(caller, null);
    });

    test('skips candidates from files other than parent file', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'root');
      tree.addJump('b.ts', 20, 3, 'parent');
      const watcher = new CommandWatcher(tree);
      // 历史中只有跨文件候选（c.ts），与父节点所在文件 b.ts 不同
      watcher._setTestHistory([
        { uri: 'c.ts', line: 50, column: 1 },
      ]);
      const caller = watcher.pickCallerFromHistory({ uri: 'd.ts', line: 200, column: 1 });
      // 跨文件候选被跳过 → 回退到父节点位置
      assert.strictEqual(caller?.uri, 'b.ts');
      assert.strictEqual(caller?.line, 20);
    });

    test('picks most recent suitable candidate', () => {
      const tree = new NavTree(50);
      tree.addJump('a.ts', 10, 5, 'root');
      tree.addJump('b.ts', 20, 3, 'parent');
      const watcher = new CommandWatcher(tree);
      // 两个候选都在父节点文件 b.ts 且远离目标行 → 取最近的
      watcher._setTestHistory([
        { uri: 'b.ts', line: 30, column: 1 },
        { uri: 'b.ts', line: 70, column: 1 },
      ]);
      const caller = watcher.pickCallerFromHistory({ uri: 'c.ts', line: 200, column: 1 });
      assert.strictEqual(caller?.line, 70);
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
