# Changelog

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
