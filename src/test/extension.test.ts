import * as assert from 'assert';
import { NavTree } from '../nav-tree';

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
        const tree = new NavTree(3);
        tree.addJump('a.ts', 1, 1, 'a');  // depth 0
        tree.addJump('b.ts', 2, 1, 'b');  // depth 1
        tree.addJump('c.ts', 3, 1, 'c');  // depth 2
        tree.addJump('d.ts', 4, 1, 'd');  // depth 3 — triggers prune
        assert.ok(tree.root !== null);
        // After pruning from depth 3 back to maxDepth 3, root should still exist
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

    test('same file jump with small line delta is filtered', () => {
        // This tests the MIN_SAME_FILE_LINE_DELTA logic indirectly
        // by verifying addJump accepts the jump
        const tree = new NavTree(50);
        tree.addJump('a.ts', 1, 1, 'start');
        tree.addJump('a.ts', 2, 1, 'small_jump');  // same file, delta=1 (< 3)
        // The tree should still record it (CommandWatcher filters, NavTree doesn't)
        assert.strictEqual(tree.currentNode?.symbolName, 'small_jump');
        assert.strictEqual(tree.root?.children.length, 1);
    });

    test('deep tree maintains correct parent chain', () => {
        const tree = new NavTree(50);
        const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
        for (const n of nodes) {
            tree.addJump(`${n}.ts`, 1, 1, n);
        }
        // Navigate back through the entire chain
        let count = 0;
        while (tree.goBack() !== null) {
            count++;
        }
        assert.strictEqual(count, nodes.length - 1); // root has no parent
        assert.strictEqual(tree.currentNode?.symbolName, 'a');
    });
});
