# Changelog

## 0.3.0

- Multi-root forest: navigation history is now a set of independent exploration trees; the bottom panel lists every root and clicking one switches the active root
- New "Create Root at Cursor": explicitly anchor an exploration at a framework entry (controller method, @Scheduled / event listener, main, or test method); subsequent F12 jumps attach under that root
- New "Promote to Root": detach a node and its whole subtree from its parent chain into a standalone root (re-anchor mid-exploration)
- New "Rename Root": root labels default to Class#method and can be renamed to human-readable titles such as GET /users
- Deleting a root now asks for modal confirmation (the whole subtree is removed as well); roots are marked with a home icon and a "root ·" prefix in the panel
- Persistence upgraded to v2: new `backtrace.navTree.v2` key with read-only fallback to the legacy key, so downgrading never loses other roots; v1 single-root data is migrated automatically
- Fix: depth pruning now falls back to the parent when it removes the current node, preventing detached nodes and a lost `currentNodeIndex` on serialization
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
