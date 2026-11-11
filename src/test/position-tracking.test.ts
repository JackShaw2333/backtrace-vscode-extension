/// <reference types="mocha" />
/// <reference types="node" />

/**
 * 位置跟随（机制 A）+ 跳转重定位（机制 B 的纯函数部分）的单测。
 *
 * 测的都是纯函数/无 UI 逻辑：
 *   - mapPosition：一条改动的行列换算（行列全用 1-based，change 用 0-based，
 *     和 NavNode / VSCode 各自的口径一致，单测里别搞混）。
 *   - PositionTracker._applyChanges：改动应用到整棵树（含调用点）。
 *   - findSymbolPosition：按符号身份找位置（假符号用普通对象字面量，
 *     不需要 VSCode 环境，靠 SymbolLike 的最小形状）。
 *   - stale 持久化往返：标过期的节点存盘再读回，标记不丢；
 *     更老的数据（没 stale 键）读回默认不过期。
 *
 * 需要真 VSCode 的部分（resolveNodePosition 的 provider 调用、
 * navigateToNodeResolved 的跳转）靠 F5 手工验证，这里不测。
 */

import * as assert from 'assert';
import { NavTree } from '../nav-tree';
import { SerializedTree } from '../nav-node';
import { mapPosition, PositionTracker, TextChange } from '../position-tracker';
import { findSymbolPosition, SymbolLike } from '../symbol-utils';

suite('mapPosition', () => {
  test('inserting lines above the node shifts it down', () => {
    // 在第 5 行前面插入 3 行（0-based start=end=第 4 行行首）
    const change: TextChange = { startLine: 4, startChar: 0, endLine: 4, endChar: 0, newText: 'a\nb\nc\n' };
    assert.deepStrictEqual(mapPosition(20, 3, change), { line: 23, column: 3 });
  });

  test('deleting lines above the node shifts it up', () => {
    // 删掉 0-based 第 1～2 行（endLine=3 独占，即删 2 行）
    const change: TextChange = { startLine: 1, startChar: 0, endLine: 3, endChar: 0, newText: '' };
    assert.deepStrictEqual(mapPosition(10, 5, change), { line: 8, column: 5 });
  });

  test('same-line insertion before the node column shifts the column', () => {
    // 第 10 行行首插入两个空格（0-based 第 9 行）
    const change: TextChange = { startLine: 9, startChar: 0, endLine: 9, endChar: 0, newText: '  ' };
    assert.deepStrictEqual(mapPosition(10, 5, change), { line: 10, column: 7 });
  });

  test('same-line insertion after the node column leaves it alone', () => {
    // 插入点（0-based 列 10）在节点列（0-based 列 4）之后 → 不动
    const change: TextChange = { startLine: 9, startChar: 10, endLine: 9, endChar: 10, newText: 'xx' };
    assert.deepStrictEqual(mapPosition(10, 5, change), { line: 10, column: 5 });
  });

  test('pressing enter before the node splits the line', () => {
    // 在 0-based (9, 2) 处回车：节点 (10, 5) 被挤到下一行，
    // 列 = 原列 − 劈开列 → 0-based (10, 2) → 1-based (11, 3)
    const change: TextChange = { startLine: 9, startChar: 2, endLine: 9, endChar: 2, newText: '\n' };
    assert.deepStrictEqual(mapPosition(10, 5, change), { line: 11, column: 3 });
  });

  test('deletion covering the node clamps it to the change start', () => {
    // 整段删掉 1-based 第 5～7 行，节点 (6, 3) 的锚点文本没了 → 钳到 (5, 1)
    const change: TextChange = { startLine: 4, startChar: 0, endLine: 7, endChar: 0, newText: '' };
    assert.deepStrictEqual(mapPosition(6, 3, change), { line: 5, column: 1 });
  });

  test('same-line rename shifts columns after the replaced range', () => {
    // 0-based 第 9 行列 4～9 的 5 个字符换成 8 个字符（净 +3），节点在列 20（1-based）
    const change: TextChange = { startLine: 9, startChar: 4, endLine: 9, endChar: 9, newText: 'longName' };
    assert.deepStrictEqual(mapPosition(10, 20, change), { line: 10, column: 23 });
  });

  test('change below the node leaves it alone', () => {
    const change: TextChange = { startLine: 30, startChar: 0, endLine: 32, endChar: 0, newText: '' };
    assert.deepStrictEqual(mapPosition(10, 5, change), { line: 10, column: 5 });
  });

  test('insert then undo restores the original position', () => {
    // 先插入 2 行再原样删掉（模拟 Ctrl+Z）→ 回到原点，证明撤销天然对称
    const insert: TextChange = { startLine: 2, startChar: 0, endLine: 2, endChar: 0, newText: 'x\ny\n' };
    const undo: TextChange = { startLine: 2, startChar: 0, endLine: 4, endChar: 0, newText: '' };
    const moved = mapPosition(10, 5, insert);
    assert.deepStrictEqual(moved, { line: 12, column: 5 });
    assert.deepStrictEqual(mapPosition(moved.line, moved.column, undo), { line: 10, column: 5 });
  });
});

suite('PositionTracker._applyChanges', () => {
  test('shifts nodes in the edited file and reports moved=true', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 10, 5, 'root');
    tree.addJump('b.ts', 20, 3, 'child');
    const tracker = new PositionTracker(tree);
    const moved = tracker._applyChanges('b.ts', [
      { startLine: 0, startChar: 0, endLine: 0, endChar: 0, newText: 'x\ny\nz\n' },
    ]);
    assert.strictEqual(moved, true);
    // b.ts 节点下移 3 行，a.ts 根节点不动
    assert.strictEqual(tree.root?.line, 10);
    assert.strictEqual(tree.currentNode?.line, 23);
  });

  test('shifts caller positions pointing into the edited file', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 10, 5, 'root');
    // 子节点的调用点在 a.ts:50
    tree.addJump('b.ts', 20, 3, 'child', '', { uri: 'a.ts', line: 50, column: 7 });
    const tracker = new PositionTracker(tree);
    const moved = tracker._applyChanges('a.ts', [
      { startLine: 0, startChar: 0, endLine: 0, endChar: 0, newText: 'h1\nh2\nh3\n' },
    ]);
    assert.strictEqual(moved, true);
    // 根节点自身 (10,5) 同样下移，调用点 50 → 53
    assert.strictEqual(tree.root?.line, 13);
    assert.strictEqual(tree.currentNode?.callerLine, 53);
  });

  test('returns false when no node lives in the edited file', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 10, 5, 'root');
    const tracker = new PositionTracker(tree);
    assert.strictEqual(
      tracker._applyChanges('other.ts', [{ startLine: 0, startChar: 0, endLine: 0, endChar: 0, newText: 'x\n' }]),
      false,
    );
    assert.strictEqual(tree.root?.line, 10);
  });

  test('returns false for empty change list', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 10, 5, 'root');
    const tracker = new PositionTracker(tree);
    assert.strictEqual(tracker._applyChanges('a.ts', []), false);
  });

  test('shifts nodes of every root, not only the active one', () => {
    const tree = new NavTree(50);
    tree.addRoot('a.ts', 10, 5, 'rootA');
    const b = tree.addRoot('b.ts', 20, 3, 'rootB');
    // 当前活动根是 b（addRoot 会切换），编辑 a.ts 不应只修活动根。
    assert.strictEqual(tree.root, b);

    const tracker = new PositionTracker(tree);
    const moved = tracker._applyChanges('a.ts', [
      { startLine: 0, startChar: 0, endLine: 0, endChar: 0, newText: 'x\ny\n' },
    ]);
    assert.strictEqual(moved, true);
    assert.strictEqual(tree.roots[0].line, 12);
    assert.strictEqual(tree.roots[1].line, 20);
  });
});

suite('findSymbolPosition', () => {
  // 造假符号的快捷函数：行号用 0-based（VSCode 口径），函数内部会 +1。
  // 普通对象字面量即可，不需要 new vscode.DocumentSymbol。
  function sym(name: string, line0: number, children: SymbolLike[] = []): SymbolLike {
    return { name, range: { start: { line: line0, character: 0 } }, children };
  }

  test('finds a nested symbol by full context path', () => {
    const symbols = [sym('App', 0, [sym('ngOnInit', 9)])];
    // 记录的是 contextName="App"、symbolName="ngOnInit" → 0-based 9 → 1-based 10
    assert.deepStrictEqual(findSymbolPosition(symbols, 'ngOnInit', 'App', 15), { line: 10, column: 1 });
  });

  test('picks the nearest overload when names collide', () => {
    const symbols = [sym('foo', 4), sym('foo', 49)];
    // 两个顶层 foo，旧行号 48 → 选第 50 行的（离得近）
    assert.deepStrictEqual(findSymbolPosition(symbols, 'foo', '', 48), { line: 50, column: 1 });
  });

  test('falls back to name search when the dotted path cannot match', () => {
    // context 里带 '.' 的符号名按 '.' 切分会对不上路径 → 退化成全树搜同名
    const symbols = [sym('Wrapper', 0, [sym('target', 29)])];
    assert.deepStrictEqual(findSymbolPosition(symbols, 'target', 'A.B', 100), { line: 30, column: 1 });
  });

  test('returns null when the name is unknown or missing', () => {
    const symbols = [sym('App', 0)];
    assert.strictEqual(findSymbolPosition(symbols, 'gone', 'App', 10), null);
    assert.strictEqual(findSymbolPosition(symbols, '', 'App', 10), null);
    assert.strictEqual(findSymbolPosition(symbols, '(symbol)', '', 10), null);
    assert.strictEqual(findSymbolPosition([], 'foo', '', 10), null);
  });
});

suite('stale persistence', () => {
  test('serialize and deserialize preserves the stale flag', () => {
    const tree = new NavTree(50);
    tree.addJump('a.ts', 10, 5, 'a');
    tree.addJump('b.ts', 20, 3, 'b');
    tree.currentNode!.stale = true;
    const tree2 = new NavTree(50);
    tree2.deserialize(tree.serialize());
    assert.strictEqual(tree2.root?.children[0]?.stale, true);
    assert.strictEqual(tree2.root?.stale, false);
  });

  test('legacy data without the stale field deserializes to not-stale', () => {
    // 手工构造更老的数据（连 stale 键都没有）→ 默认没过期
    const legacy: SerializedTree = {
      nodes: [
        {
          uri: 'a.ts',
          line: 10,
          column: 5,
          symbolName: 'a',
          contextName: '',
          parentIndex: null,
          childrenIndices: [],
          timestamp: 0,
        },
      ],
      currentNodeIndex: 0,
      maxDepth: 50,
    };
    const tree = new NavTree(50);
    tree.deserialize(legacy);
    assert.strictEqual(tree.root?.stale, false);
  });
});
