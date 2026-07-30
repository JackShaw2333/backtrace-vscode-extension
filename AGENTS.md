# Backtrace VSCode Extension

VSCode 扩展：用**树形导航**替代 VSCode 原生线性堆栈导航历史，仅记录有意义的导航跳转（F12/Ctrl+Click 等），支持后退/前进、侧边栏树视图、持久化。

> **当前状态：v0.1.3** — 所有模块通过 tsc 编译 + eslint 检查，准备发布。

---

## Project

- **用途**：解决 VSCode Alt+← 经过太多无关点击的问题，用树结构管理导航历史
- **栈**：TypeScript + VSCode Extension API
- **入口点**：`src/extension.ts`（activate / deactivate）
- **包名**：`backtrace`（`package.json` 中定义）
- **根目录**：`C:\Users\jared\backtrace-vscode-extension\`

---

## Commands

| 命令 | 用途 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run compile` | tsc 编译到 out/ |
| `npm run watch` | 监听模式编译 |
| `npm run lint` | eslint 检查（flat config） |
| `npm run format` | Prettier 格式化 src/ |
| `npm run test` | 运行 Mocha 测试 |
| `F5`（VSCode） | 启动 Extension Development Host 调试 |

---

## 架构

```
src/
├── extension.ts              # activate / deactivate
├── nav-tree.ts               # 树数据结构 + 持久化 + dump 日志
├── nav-node.ts               # NavNode 接口与序列化类型
├── command-watcher.ts        # 导航拦截与位置捕获（onDidChangeTextEditorSelection）
├── symbol-utils.ts           # 从文件位置提取函数/类上下文
├── config.ts                 # 设置读取
├── constants.ts              # 常量（颜色、防抖时间、持久化 key）
├── providers/
│   ├── path-provider.ts      # 侧边栏堆栈视图（扁平列表：root→currentNode）
│   └── tree-panel-provider.ts # 底部面板树视图（完整展开树）
└── commands/
    ├── go-back.ts            # 后退命令
    ├── go-forward.ts         # 前进命令（多分支：notification / quickpick）
    ├── delete-node.ts        # 删除节点命令
    ├── jump-to-caller.ts     # 跳转到调用位置（callerUri/callerLine）
    └── navigate.ts           # 跳转到节点位置（isInternalNav 标志）
```

### 关键模块

| 模块 | 职责 |
|------|------|
| `NavTree` | 树形数据结构（NavNode），含 parent/children 链接、addJump/goBack/goForward/removeNode、serialize/deserialize、dump 日志 |
| `CommandWatcher` | 用 `onDidChangeTextEditorSelection`（event.kind === Command）拦截 F12/Ctrl+Click 跳转，捕获 callerPosition（调用点），120ms 防抖后确认并记录 |
| `config` | 从 `vscode.workspace.getConfiguration('backtrace')` 读取设置 |
| `BacktracePathProvider` | TreeDataProvider，侧边栏（id: `backtraceStack`）— 扁平列表显示 root→currentNode 线性路径 |
| `BacktraceTreePanelProvider` | TreeDataProvider，底部面板（id: `backtraceTree`）— 完整展开树，右键 × 删除节点 |
| `goBack/goForward` | 注册 `backtrace.goBack` / `backtrace.goForward` 命令 |
| `jumpToCaller` | 注册 `backtrace.jumpToCaller` 命令 — 跳转到节点的 callerUri/callerLine 位置 |

### 数据结构

```ts
interface NavNode {
  uri: string
  line: number
  column: number
  symbolName: string
  contextName: string
  children: NavNode[]
  parent: NavNode | null
  timestamp: number
  callerUri?: string | null
  callerLine?: number | null
  callerColumn?: number | null
}

interface NavTree {
  root: NavNode | null
  currentNode: NavNode | null
  maxDepth: number
}
```

### 核心流程

```
onDidChangeTextEditorSelection(event.kind === Command)
  → 快照 lastKnownPosition（调用点）
  → 检测 Ctrl+Click（300ms 内有 Mouse 事件 → 用 Mouse 位置作调用点）
  → 120ms 防抖确认光标稳定
  → 获取符号上下文（DocumentSymbolProvider）
  → push 为 currentNode 的子节点（含 callerPosition），currentNode 指向新节点

backtrace.goBack  → currentNode = currentNode.parent（不删子节点）
backtrace.goForward：
  → 0 子节点 → 状态栏提示
  → 1 子节点 → 直接进入
  → >1 子节点 → 取决于 forwardBehavior 设置：
      notification（默认）→ 状态栏提示，用户通过侧边栏选择
      quickpick → 弹出 QuickPick 选择
```

---

## 设置项

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `backtrace.maxTreeDepth` | `number` | `50` | 树上限深度 |
| `backtrace.persistHistory` | `boolean` | `true` | 是否持久化 |
| `backtrace.forwardBehavior` | `string` | `"notification"` | 多分支前进行为：`notification` / `quickpick` |

## 快捷键

| 命令 | 默认快捷键 |
|------|-----------|
| `backtrace.goBack` | Ctrl+Alt+[ |
| `backtrace.goForward` | Ctrl+Alt+] |

---

## 参考插件

- **Code Navigation Stack**（RoeeBarnea.code-navigation-stack）：TreeView + WebviewView 布局参考
- **Call-Site Navigator**（srk-tools.call-site-navigator）：通过注册 DefinitionProvider 拦截 Ctrl+Click 的技术方案参考

---

## Conventions

- **语言**：TypeScript，严格模式
- **格式化**：Prettier（`.prettierrc` 已配置）
- **检查**：ESLint（已配置 flat config `eslint.config.mjs`）
- **测试框架**：Mocha + tdd 模式（`--ui tdd`）
- **命名**：camelCase 变量/函数，PascalCase 类/类型/接口，kebab-case 文件名
- **导入**：CommonJS（tsconfig `module: "commonjs"`），使用 `import` 语法
- **状态管理**：通过 `context.workspaceState` 持久化，`context.subscriptions` 注册 dispose
- **UI**：TreeView（侧边栏 + 底部面板），均在 `package.json` 的 `contributes` 中声明
- **构建**：`tsc` 编译到 `out/` 目录
- **提交规范**：每次对代码的增删修改后**必须立即 commit**，commit message 格式：
  - `feat: xxx` — 新功能
  - `fix: xxx` — 修复 bug
  - `docs: xxx` — 文档/注释修改
  - `chore: xxx` — 构建/配置/杂项
  - `test: xxx` — 测试相关
  - `refactor: xxx` — 重构
  - 不允许出现未 commit 的修改跨多个 session

---

## Notes

<!-- 快速备注区 -->
