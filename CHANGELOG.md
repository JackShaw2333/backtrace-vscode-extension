# Changelog

## 0.3.1

- Multi-root forest: navigation history is now a set of independent exploration trees. The bottom panel lists every root, clicking a root or node switches the active root, and the sidebar shows the path from the active root to the current node
- New "Create Root at Cursor": anchors an exploration at the caret position (the label still comes from the enclosing symbol), so framework entries such as controller methods, `@Scheduled` methods and event listeners can be marked explicitly
- New "Promote to Root": detaches a node and its whole subtree from its parent chain into a standalone root, for re-anchoring an exploration mid-way
- New "Rename Root": root labels default to Class#method and can be renamed to human-readable titles such as `GET /users`; submitting an empty value restores the automatic label
- Roots are marked with a home icon and a `root ·` prefix; deleting a root asks for confirmation and removes its whole subtree
- Persistence upgraded to v2: new `backtrace.navTree.v2` key with read-only fallback to the legacy `backtrace.navTree` key; v1 single-root data is migrated automatically. After upgrading, new history is written only to v2, so downgrading shows the pre-upgrade tree rather than later history
- Fix: depth pruning now runs per tree, never deletes a root, and moves the current node back to its parent when the current node itself is pruned
- Fix: deleting a root recomputes the active root from the current node and normalizes state, so the active root can no longer drift from the current node
- Fix: `rootOf()` is guarded against parent-chain cycles in corrupted persisted data, which could previously hang extension activation
- Fix: the active root now follows the current node when using Jump to Caller from a node that lives in another tree
- Fix: caller suffixes on root nodes now show the caller file name instead of the node's own file
- Fix: commands that require a tree node argument (delete, jump-to-caller, move up/down, rename root, promote to root) are hidden from the Command Palette
- Fix: false stale markers. Symbol resolution now tries the recorded full context path and always falls back to a name lookup, so an unchanged node is no longer marked stale just because the recorded word was an annotation/comment word or because the context was empty at record time
- Fix: creating a root keeps the enclosing symbol identity while recording the cursor position, so a root created from a comment/annotation line does not turn stale on first click
- Test harness: repaired `npm test` (vscode-test with VS Code 1.90 pinned, working around the Electron/Code executable rename in newer macOS builds of `@vscode/test-electron`)
- Intentionally no re-parenting/drag-and-drop: parent links record exploration order, and rewriting them would fabricate a call path; structural edits are limited to sibling reordering and promote-to-root

## 0.2.0

- Reorder siblings with the inline ↑ / ↓ buttons in the bottom panel (forward QuickPick order follows the new order)

## 0.1.4

- Track only definition-style jumps: Definition / Declaration / Implementation / Type Definition providers record a jump intent, so Find matches, Outline clicks and search-result clicks no longer pollute the tree (replaces the old Mouse-event call-site heuristic — call-sites are now exact for both F12 and Ctrl+Click)
- Recorded positions follow source edits: live line-shift tracking while editing, plus symbol-based re-resolve on every jump (self-healing write-back); unresolvable nodes are greyed out as stale instead of jumping to the wrong line, and back/forward stops on them with a notice rather than breaking the chain

## 0.1.3

- Fix caller position semantics: callerPosition now records the **call-site** (the symbol reference clicked/pointed at), not the cursor's previous location
- F12 (keyboard): precisely captures the call-site since the cursor is already on the symbol
- Ctrl+Click (mouse): uses the Mouse event position when VSCode reports it; falls back to the parent node's recorded position otherwise
- README: added tip recommending F12 for the most accurate call-site tracking

## 0.1.2

- Fix incorrect line positions on recorded nodes: use `event.textEditor` instead of `activeTextEditor` for cross-file jumps, and preserve callerPosition across debounced multi-event commands

## 0.1.1

- Jump-to-caller button now appears first (more prominent) in tree panel inline actions
- Delete node button simplified to a simple × icon and moved to second position

## 0.1.0

- Jump to Caller: nodes record the pre-jump cursor position (caller site) and expose a one-click button to navigate back to it
- Caller line shown in tree node descriptions (`← from file:line`)
- Full tree navigation: go back / go forward with multi-branch QuickPick or notification mode
- Sidebar "Backtrace Stack" (linear root→current path) and bottom panel "Backtrace Tree" (full expanded tree)
- Workspace-scoped persistence across VSCode sessions
- Inline delete button to prune branches
- Configurable: `maxTreeDepth`, `persistHistory`, `forwardBehavior`
- Default keybindings: `Ctrl+Alt+[` (back), `Ctrl+Alt+]` (forward)
