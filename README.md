# Backtrace

![VS Code](https://img.shields.io/badge/VS%20Code-1.82%2B-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

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
- **Position tracking** — recorded locations follow source edits live and re-resolve by symbol on jump; unresolvable nodes are greyed out as stale instead of jumping to the wrong line
- **Delete nodes** — prune uninteresting branches with the inline × button
- **Reorder siblings** — use the inline ↑ / ↓ buttons in the bottom panel to reorder siblings (forward QuickPick order follows)

## Requirements

VS Code **1.82.0** or newer.

## Install

- **From the Marketplace**: search for `Backtrace` in the Extensions view, or install from
  [marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=jaredshaw.backtrace)
- **From a VSIX**: download `backtrace-<version>.vsix` from the
  [Releases](https://github.com/JackShaw2333/backtrace-vscode-extension/releases) page, then run
  `code --install-extension backtrace-<version>.vsix`, or use
  *Extensions → ⋯ → Install from VSIX…*

## Keyboard Shortcuts

| Command | Windows / Linux | macOS |
|---------|----------------|-------|
| Backtrace: Go Back | `Ctrl+Alt+[` | `Ctrl+Cmd+[` |
| Backtrace: Go Forward | `Ctrl+Alt+]` | `Ctrl+Cmd+]` |

> **Why not `Cmd+Opt+[` on Mac?** That's VS Code's built-in Fold/Unfold shortcut.
> The Mac bindings keep the same `[` / `]` pair and just swap `Alt` for `Cmd`,
> following the usual Ctrl→Cmd platform convention without hijacking Fold.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `backtrace.maxTreeDepth` | number | `50` | Maximum depth of the navigation tree |
| `backtrace.persistHistory` | boolean | `true` | Persist navigation tree across VSCode sessions |
| `backtrace.forwardBehavior` | string | `"notification"` | How to handle multiple forward targets: `notification` or `quickpick` |

## How It Works

1. You press F12 (Go to Definition) or Ctrl+Click a symbol
2. Backtrace captures the **call-site** (the symbol reference you jumped from) and the **destination**
3. A new node is added as a child of the current node in the tree
4. Use `Ctrl+Alt+[` / `Ctrl+Alt+]` (`Ctrl+Cmd+[` / `Ctrl+Cmd+]` on macOS) to walk back and forth through your exploration

> **Tip:** For the most accurate call-site tracking, prefer **F12** over Ctrl+Click.
> F12 requires the cursor to be on the symbol first, so Backtrace can precisely
> record the call-site line. Ctrl+Click captures the click position when VSCode
> reports it; otherwise it falls back to the parent node's recorded position.

## Views

- **Sidebar → Backtrace Stack**: shows the linear path from root to your current position
- **Panel → Backtrace → Backtrace Tree**: shows the full tree with all branches; inline buttons let you reorder siblings (↑ / ↓), jump to the caller site or delete a node

## Known Limitations

- **Only definition-style jumps are tracked.** Go to Definition (F12 / Ctrl+Click),
  Go to Declaration, Go to Implementation and Go to Type Definition are recorded;
  Go to References, Peek Definition, breadcrumb jumps and search-result clicks are not.
- **Peek views are not captured.** A definition lookup only becomes a node once the cursor
  actually lands on a result. Opening a Peek view never moves the selection, so it is ignored.
- **Call-sites are exact.** The call-site is taken from the position VSCode passes to the
  definition provider, so F12 and Ctrl+Click are equally precise.
- **Jump-to-Caller tracks live edits only.** Call-site lines shift as you edit open files,
  but are not symbol-resolved on jump (a call-site is a line inside a function body, not a
  symbol definition), so large out-of-session refactors may leave them slightly off.
- **History is workspace-scoped.** The tree is persisted per workspace and is not shared between
  windows or workspaces.
- **Depth is capped.** The tree stops growing at `backtrace.maxTreeDepth` (default 50).

## Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/JackShaw2333/backtrace-vscode-extension.git
cd backtrace-vscode-extension
npm install
```

Press `F5` in VSCode to launch an Extension Development Host with the extension loaded.

| Script | Purpose |
|--------|---------|
| `npm run compile` | TypeScript build to `out/` |
| `npm run watch` | Incremental build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

Please run `npm run compile` and `npm run lint` before opening a PR.

## License

[MIT](LICENSE)
