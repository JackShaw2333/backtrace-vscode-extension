# Changelog

## 0.1.3

- Fix Ctrl+Click recording wrong caller positions: use a small position history and filter out the intermediate click location (the symbol under the cursor) so the child node records the pre-click cursor line, not the clicked symbol line. Falls back to the parent's recorded position when no suitable candidate exists.

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
