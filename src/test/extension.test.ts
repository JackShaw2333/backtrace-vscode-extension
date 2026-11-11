/// <reference types="mocha" />
/// <reference types="node" />

import * as assert from 'assert';
import { NavTree } from '../nav-tree';
import { BacktraceConfig } from '../config';
import { DefinitionInterceptor, DefinitionIntent, DEFINITION_INTENT_WINDOW_MS } from '../definition-interceptor';

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
    tree.addJump('a.ts', 1, 1, 'a'); // depth 0
    tree.addJump('b.ts', 2, 1, 'b'); // depth 1
    tree.addJump('c.ts', 3, 1, 'c'); // depth 2 — still <= maxDepth(2)
    tree.addJump('d.ts', 4, 1, 'd'); // depth 3 — exceeds maxDepth, triggers prune
    assert.ok(tree.root !== null);
    // 裁剪删掉的是 current（最旧叶子 d），current 应回退到父节点 c，
    // 而不是继续指向已脱离森林的 d；根 a 保持不变。
    assert.strictEqual(tree.currentNode?.symbolName, 'c');
    const restored = new NavTree(50);
    restored.deserialize(tree.serialize());
    assert.strictEqual(restored.currentNode?.symbolName, 'c');
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

  // ── DefinitionInterceptor 意图机制测试 ────────────────
  // 验证"意图记录 + 落点对号入座"的过滤逻辑：
  //   - 落点命中意图目标 → 返回意图（含精确调用点），意图被一次性消费
  //   - 落点没命中（Outline / Find / 搜索点击）→ 返回 null，意图保留
  //   - 过期意图（Peek 预览只看没跳留下的）→ 被淘汰，返回 null
  // 说明：这里用 _injectTestIntent 手工构造"用户刚查过定义"的现场，
  // 不需要真正的语言服务器；真正的 Provider 流程靠 F5 手工验证。
  suite('DefinitionInterceptor', () => {
    // 造一条意图的快捷函数：从 a.ts:50 查定义，目标是 b.ts:20。
    // 为什么抽成函数？6 个用例都要造意图，避免复制粘贴一堆对象字面量。
    function makeIntent(overrides: Partial<DefinitionIntent> = {}): DefinitionIntent {
      return {
        kind: 'definition',
        caller: { uri: 'a.ts', line: 50, column: 7 },
        targets: [{ uri: 'b.ts', line: 20, column: 3 }],
        at: Date.now(),
        ...overrides,
      };
    }

    test('matching landing consumes the intent and returns its caller', () => {
      const interceptor = new DefinitionInterceptor();
      interceptor._injectTestIntent(makeIntent());
      // 落点 b.ts:20 正好是意图目标 → 命中
      const intent = interceptor.consumeIntentIfMatches('b.ts', 20);
      assert.strictEqual(intent?.caller.uri, 'a.ts');
      assert.strictEqual(intent?.caller.line, 50);
      assert.strictEqual(intent?.kind, 'definition');
      // 一次性消费：再问一次就没有了（防一次 F12 记多条）
      assert.strictEqual(interceptor.consumeIntentIfMatches('b.ts', 20), null);
      assert.strictEqual(interceptor._getIntentCount(), 0);
    });

    test('non-matching landing returns null and keeps the intent', () => {
      const interceptor = new DefinitionInterceptor();
      interceptor._injectTestIntent(makeIntent());
      // 落点 c.ts:99 不是查定义的目标（模拟 Outline 点击）→ 不命中
      assert.strictEqual(interceptor.consumeIntentIfMatches('c.ts', 99), null);
      // 意图还在：真正的定义跳转落点稍后才到，不能提前丢
      assert.strictEqual(interceptor._getIntentCount(), 1);
      // 真落点到了 → 命中
      assert.ok(interceptor.consumeIntentIfMatches('b.ts', 20) !== null);
    });

    test('expired intent is dropped (peek without jump leaves no trace)', () => {
      const interceptor = new DefinitionInterceptor();
      // 意图是很久以前记的（超过有效期）→ 模拟"Peek 看了但没跳"
      interceptor._injectTestIntent(makeIntent({ at: Date.now() - DEFINITION_INTENT_WINDOW_MS - 100 }));
      assert.strictEqual(interceptor.consumeIntentIfMatches('b.ts', 20), null);
      assert.strictEqual(interceptor._getIntentCount(), 0);
    });

    test('matches the newest intent when several are stored', () => {
      const interceptor = new DefinitionInterceptor();
      // 快速连按两次 F12：第一次目标 b.ts:20，第二次目标 d.ts:40
      interceptor._injectTestIntent(makeIntent());
      interceptor._injectTestIntent(
        makeIntent({
          kind: 'implementation',
          caller: { uri: 'c.ts', line: 5, column: 1 },
          targets: [{ uri: 'd.ts', line: 40, column: 2 }],
        }),
      );
      // 第二次的落点先到 → 命中第二条（从新到旧找）
      const intent = interceptor.consumeIntentIfMatches('d.ts', 40);
      assert.strictEqual(intent?.kind, 'implementation');
      assert.strictEqual(intent?.caller.uri, 'c.ts');
      // 第一条还在，等它自己的落点
      assert.strictEqual(interceptor._getIntentCount(), 1);
    });

    test('column differences are tolerated (uri + line match only)', () => {
      const interceptor = new DefinitionInterceptor();
      interceptor._injectTestIntent(makeIntent());
      // 只传 uri + line，不传 column：落点列和目标列有微小差异也算命中，
      // 容忍各语言服务器返回的目标列与 VSCode 实际落点列的不一致。
      assert.ok(interceptor.consumeIntentIfMatches('b.ts', 20) !== null);
    });

    test('clearIntents empties the store', () => {
      const interceptor = new DefinitionInterceptor();
      interceptor._injectTestIntent(makeIntent());
      interceptor._injectTestIntent(makeIntent());
      assert.strictEqual(interceptor._getIntentCount(), 2);
      interceptor._clearIntents();
      assert.strictEqual(interceptor._getIntentCount(), 0);
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
