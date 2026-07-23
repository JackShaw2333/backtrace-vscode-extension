# Backtrace

Tree-based navigation history for VSCode. Instead of a flat linear back-stack, Backtrace records your code exploration as a **tree** — every F12 / Ctrl+Click jump becomes a node, and you can backtrack or branch forward through your actual exploration trail.

## Why?

VSCode's built-in `Alt+←` navigates through *every* cursor movement — accidental clicks, scroll-induced selections, and intentional jumps all mixed together. Backtrace only records **meaningful navigation commands** (Go to Definition by default), giving you a clean history of *where you explored* and *how you got there*.

## Features

- **Tree navigation** — each jump creates a child node; going back never destroys forward branches
- **Sidebar view (Backtrace Stack)** — flat linear path from root to current node
- **Bottom panel view (Backtrace Tree)** — full expanded tree with all branches visible
- **Jump to Caller** — one click to see the exact call-site line that led to the current node
- **Go Back / Go Forward** — keyboard-driven navigation through the tree
- **Multi-branch forward** — when multiple forward paths exist, choose via notification or QuickPick
- **Persistence** — tree survives VSCode restarts (workspace-scoped)
- **Delete nodes** — prune uninteresting branches with the inline × button

## Keyboard Shortcuts

| Command | Default Keybinding |
|---------|-------------------|
| Backtrace: Go Back | `Ctrl+Alt+[` |
| Backtrace: Go Forward | `Ctrl+Alt+]` |

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `backtrace.maxTreeDepth` | number | `50` | Maximum depth of the navigation tree |
| `backtrace.persistHistory` | boolean | `true` | Persist navigation tree across VSCode sessions |
| `backtrace.forwardBehavior` | string | `"notification"` | How to handle multiple forward targets: `notification` or `quickpick` |

## How It Works

1. You press F12 (Go to Definition) or Ctrl+Click a symbol
2. Backtrace captures your **pre-jump position** (the caller) and the **destination**
3. A new node is added as a child of the current node in the tree
4. Use `Ctrl+Alt+[` / `Ctrl+Alt+]` to walk back and forth through your exploration

## Views

- **Sidebar → Backtrace Stack**: shows the linear path from root to your current position
- **Panel → Backtrace → Backtrace Tree**: shows the full tree with all branches; inline buttons let you jump to the caller site or delete a node

## License

[MIT](LICENSE)
