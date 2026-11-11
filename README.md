# Backtrace

![VS Code](https://img.shields.io/badge/VS%20Code-1.82%2B-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

Tree-based navigation history for VSCode. Instead of a flat linear back-stack, Backtrace records your code exploration as a **forest of trees** — every F12 / Ctrl+Click jump becomes a node, and you can backtrack or branch forward through your actual exploration trail.

## Why?

VSCode's built-in `Alt+←` navigates through *every* cursor movement — accidental clicks, scroll-induced selections, and intentional jumps all mixed together. Backtrace only records **meaningful navigation commands** (Go to Definition by default), giving you a clean history of *where you explored* and *how you got there*.

Framework projects (Spring Boot, NestJS, event listeners, scheduled jobs…) hide their real entry points behind a dispatcher or container, so the first recorded jump is rarely the place your exploration "starts". **Roots** solve that: put the cursor on the framework entry (a controller method, a `@Scheduled` method, `main`, a test…) and create a root. Each root is an independent exploration thread, and the bottom panel shows them all.

## Features

- **Multiple roots (forest)** — every root is an independent exploration thread; the bottom panel lists all of them and clicking one switches the active root
- **Create Root at Cursor** — explicitly anchor an exploration at the current cursor position (the label comes from the enclosing symbol; great for framework entry points)
- **Promote to Root** — detach any node together with its subtree from its parent chain and turn it into a new root (re-anchor mid-exploration)
- **Rename Root** — root labels default to `Class#method`, but can be renamed to something human-readable such as `GET /users`
- **Tree navigation** — each jump creates a child node; going back never destroys forward branches
- **Sidebar view (Backtrace Stack)** — flat linear path from the active root to the current node
- **Bottom panel view (Backtrace Tree)** — the full forest, with all roots and branches visible
- **Jump to Caller** — one click to see the exact call-site line that led to the current node
- **Go Back / Go Forward** — keyboard-driven navigation through the tree
- **Multi-branch forward** — when multiple forward paths exist, choose via notification or QuickPick
- **Persistence** — forest survives VSCode restarts (workspace-scoped); stored under `backtrace.navTree.v2` with a read-only fallback to the legacy 0.2.x key; v1 single-root data is migrated automatically
- **Position tracking** — recorded locations follow source edits live and re-resolve by symbol on jump; unresolvable nodes are greyed out as stale instead of jumping to the wrong line
- **Delete nodes / roots** — prune uninteresting branches with the inline × button; deleting a root asks for confirmation first
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

## Roots: anchoring framework projects

Backtrace normally starts a root implicitly: if the forest is empty, the first recorded jump becomes the root. For framework-heavy projects you usually want an explicit anchor instead:

1. Put the cursor on the entry point — a controller method, a `@Scheduled` / `@EventListener` method, `main`, or a test method.
2. Run **Backtrace: Create Root at Cursor** (Command Palette, or right-click in the editor).
3. Press F12 from there — every subsequent jump becomes a child of that root.
4. Repeat for the next entry point. Previous roots stay intact; switch between them from the **Backtrace Tree** panel.

If you already explored a bit before realizing you wanted a different anchor, select a node in the bottom panel and run **Backtrace: Promote to Root** — it keeps the node and its whole subtree, detaches it from the parent chain, and makes it a root. **Backtrace: Rename Root** gives it a readable label.

Roots record the **caret position**, not the symbol declaration — put the caret exactly where you want the anchor to be. The label is still taken from the enclosing symbol (`Class#method`), so the tree stays readable.

Intentionally **not** supported: re-parenting a node to an arbitrary parent, or drag-and-drop across branches. A node's parent records "where I jumped from"; rewriting it would fabricate a call path that never happened. The only structural edits are sibling reordering and promote-to-root.

## Keyboard Shortcuts

| Command | Windows / Linux | macOS |
|---------|----------------|-------|
| Backtrace: Go Back | `Ctrl+Alt+[` | `Ctrl+Cmd+[` |
| Backtrace: Go Forward | `Ctrl+Alt+]` | `Ctrl+Cmd+]` |

> **Why not `Cmd+Opt+[` on Mac?** That's VS Code's built-in Fold/Unfold shortcut.
> The Mac bindings keep the same `[` / `]` pair and just swap `Alt` for `Cmd`,
> following the usual Ctrl→Cmd platform convention without hijacking Fold.

Create Root at Cursor / Promote to Root / Rename Root have no default keybindings; bind them in *Keyboard Shortcuts* if you use them often.

## Commands

| Command | Available from | Notes |
|---------|----------------|-------|
| Backtrace: Go Back / Go Forward | keybindings, Command Palette | Walk the active tree |
| Backtrace: Create Root at Cursor | Command Palette, editor context menu | Anchors at the caret; label comes from the enclosing symbol |
| Backtrace: Promote to Root | tree item context menu | Non-root items only |
| Backtrace: Rename Root | root item inline action / context menu | Submitting an empty value restores the automatic label |
| Backtrace: Delete Node | tree item inline × / context menu | Deleting a root asks for confirmation |
| Backtrace: Jump to Caller | tree item inline action | Jumps to the exact call-site line |
| Backtrace: Move Node Up / Down | tree item inline ↑ / ↓ | Sibling order only |

Commands that need a tree node argument are hidden from the Command Palette; invoke them from the **Backtrace Tree** view instead.

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `backtrace.maxTreeDepth` | number | `50` | Maximum depth of **each** tree in the forest |
| `backtrace.persistHistory` | boolean | `true` | Persist the navigation forest across VSCode sessions |
| `backtrace.forwardBehavior` | string | `"notification"` | How to handle multiple forward targets: `notification` or `quickpick` |

## How It Works

1. You press F12 (Go to Definition) or Ctrl+Click a symbol
2. Backtrace captures the **call-site** (the symbol reference you jumped from) and the **destination**
3. A new node is added as a child of the current node — or, if the forest is empty, the destination becomes the first (implicit) root
4. Use `Ctrl+Alt+[` / `Ctrl+Alt+]` (`Ctrl+Cmd+[` / `Ctrl+Cmd+]` on macOS) to walk back and forth through the current tree
5. Use the bottom **Backtrace Tree** panel to see all roots and click into another exploration thread

> **Tip:** For the most accurate call-site tracking, prefer **F12** over Ctrl+Click.
> F12 requires the cursor to be on the symbol first, so Backtrace can precisely
> record the call-site line.

## Views

- **Sidebar → Backtrace Stack**: the linear path from the active root to your current position
- **Panel → Backtrace → Backtrace Tree**: the complete forest — every root and branch. Roots are marked with a home icon and a `root ·` prefix; click one to switch the active root. Inline buttons reorder siblings (↑ / ↓), jump to the caller site, rename a root or delete a node; **Promote to Root** is available from the node's context menu

## Known Limitations

- **Only definition-style jumps are tracked.** Go to Definition (F12 / Ctrl+Click),
  Go to Declaration, Go to Implementation and Go to Type Definition are recorded;
  Go to References, Peek Definition, breadcrumb jumps and search-result clicks are not.
- **Peek views are not captured.** A definition lookup only becomes a node once the cursor
  actually lands on a result. Opening a Peek view never moves the selection, so it is ignored.
- **Call-sites are exact.** The call-site is taken from the position VSCode passes to the
  definition provider, so F12 and Ctrl+Click are equally precise.
- **Jump-to-Caller tracks live edits only.** Call-site lines shift as you edit open files,
  but are not symbol-resolved on jump, so large out-of-session refactors may leave them slightly off.
- **No re-parenting / cross-branch dragging.** Parent links record navigation order; use
  **Promote to Root** to re-anchor an exploration instead.
- **Root switching is panel-driven.** Click a root or node in **Backtrace Tree** to switch the
  active root; there is no QuickPick switcher or cross-root go-back.
- **No automatic framework entry detection.** Roots are created explicitly at the cursor; the
  automatic label is the enclosing symbol (`Class#method`), not the HTTP route.
- **History is workspace-scoped.** The forest is persisted per workspace and is not shared between
  windows or workspaces. Old v1 single-root data is migrated to a single root on first load.
- **Persistence downgrade caveat.** New history is written to the `backtrace.navTree.v2` key; the
  legacy `backtrace.navTree` key is kept read-only as a fallback. Downgrading to 0.2.x therefore
  shows the pre-upgrade tree (not changes made after upgrading), and changes made while downgraded
  are not merged back after re-upgrading.
- **Depth is capped per tree.** Each root's tree stops growing at `backtrace.maxTreeDepth`
  (default 50); roots themselves are never deleted automatically.

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
| `npm test` | Run the Mocha suite in an Extension Host (`vscode-test`, current VS Code release) |

Please run `npm run compile`, `npm run lint` and `npm test` before opening a PR.

## License

[MIT](LICENSE)
