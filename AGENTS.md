# Backtrace VSCode Extension

VSCode 扩展：用**树形导航**替代 VSCode 原生线性堆栈导航历史，仅记录有意义的导航跳转（F12/Ctrl+Click 等），支持后退/前进、侧边栏路径、底部森林面板、持久化；多根森林让框架类项目可以显式标注探索起点。

> **当前状态：v0.3.2** — 所有模块通过 tsc 编译 + eslint 检查 + 87 项 mocha 单测（`vscode-test`，Extension Host，当前 VS Code 稳定版）。

---

## Project

- **用途**：解决 VSCode Alt+← 经过太多无关点击的问题，用树结构管理导航历史
- **栈**：TypeScript + VSCode Extension API
- **入口点**：`src/extension.ts`（activate / deactivate）
- **包名**：`backtrace`（`package.json` 中定义）
- **根目录**：本仓库（本机为 `/Users/jaredshaw/backtrace-vscode-extension/`）

---

## Commands

| 命令 | 用途 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run compile` | tsc 编译到 out/ |
| `npm run watch` | 监听模式编译 |
| `npm run lint` | eslint 检查（flat config） |
| `npm run format` | Prettier 格式化 src/ |
| `npm test` | 在 Extension Host 跑 Mocha 测试（vscode-test，当前 VS Code 稳定版） |
| `F5`（VSCode） | 启动 Extension Development Host 调试 |

---

## 架构

```
src/
├── extension.ts              # activate / deactivate（装配 + v2 持久化读写）
├── nav-tree.ts               # 多根森林数据结构（roots/活动根/提升为根）+ 序列化 + dump
├── nav-node.ts               # NavNode 接口与序列化类型（含 label/kind）
├── command-watcher.ts        # 跳转确认器（Command 意图命中后记入树，120ms 防抖）
├── definition-interceptor.ts # 定义拦截器（4 种定义 Provider 上记录跳转意图）
├── position-tracker.ts       # 位置跟随器（文档编辑时实时修正所有根的节点行列）
├── symbol-utils.ts           # 符号上下文提取 + 跳转时重定位（按身份找位置）
├── config.ts                 # 设置读取
├── constants.ts              # 常量（颜色、防抖时间、v1/v2 持久化 key、STALE_COLOR）
├── providers/
│   ├── path-provider.ts      # 侧边栏堆栈视图（活动根→currentNode 扁平路径，stale 置灰）
│   └── tree-panel-provider.ts # 底部面板森林视图（顶层=所有根，各根完整展开，stale 置灰）
└── commands/
    ├── create-root.ts        # 光标处建根（backtrace.createRoot）
    ├── promote-node.ts       # 把节点及其子树提升为新根（backtrace.promoteNodeToRoot）
    ├── rename-root.ts        # 重命名根标签（backtrace.renameRoot）
    ├── go-back.ts            # 后退命令（先定位后跳转，stale 不断链）
    ├── go-forward.ts         # 前进命令（多分支：notification / quickpick，先定位后跳转）
    ├── delete-node.ts        # 删除节点；删除根额外弹模态确认
    ├── jump-to-caller.ts     # 跳转到调用位置（callerUri/callerLine，笨跳无重定位）
    ├── move-node.ts          # 节点上移/下调（兄弟调序，影响前进 QuickPick 顺序）
    └── navigate.ts           # 先定位后跳转唯一出口（isInternalNav 标志 + 自愈/stale）
```

> 说明：**换父/拖拽已明确不做**（伪需求：parent 记录“从哪里跳来”，人为改父等于伪造调用路径）。
> 结构调整只保留兄弟调序（moveSibling）与提升为根（promoteToRoot）。
> 旧的拖拽尝试留档在 `backup/drag-attempt` 分支，不要在此基础上恢复。

### 关键模块

| 模块 | 职责 |
|------|------|
| `NavTree` | 多根森林数据结构：`_roots` + 活动根 + `root` getter；addJump/addRoot/promoteToRoot/goBack/goForward/removeNode/moveSibling/normalize、serialize/deserialize、dump |
| `DefinitionInterceptor` | 在定义/声明/实现/类型定义 4 种 Provider 上记录跳转意图（调用点 + 候选目标），只放行定义类跳转，过滤 Find/Outline 噪音 |
| `CommandWatcher` | 跳转确认器：`onDidChangeTextEditorSelection`（kind === Command）+ 120ms 防抖，落点命中意图才记入树，调用点取自意图（精确，无 Mouse 推测） |
| `PositionTracker` | 位置跟随器：`onDidChangeTextDocument` 实时把位移换算到同文件节点（含调用点）；stale 判定权归跳转时重定位 |
| `resolveNodePosition`（symbol-utils） | 跳转时重定位：按 symbolName + contextName 找回当前位置；三分支 found（自愈回写）/ unverifiable（信旧行号）/ missing（标 stale） |
| `config` | 从 `vscode.workspace.getConfiguration('backtrace')` 读取设置 |
| `BacktracePathProvider` | TreeDataProvider，侧边栏（id: `backtraceStack`）— 显示活动根→currentNode 的线性路径 |
| `BacktraceTreePanelProvider` | TreeDataProvider，底部面板（id: `backtraceTree`）— 顶层返回所有根，展示完整森林；根有 home 图标/“root ·”前缀，点击切换活动根 |
| `createRoot` | 光标处建根：取光标处符号上下文（Class#method）作为根标签；森林非空时追加新树 |
| `promoteNodeToRoot` | 把节点及其子树从父链摘下成为新根；清空 caller*、kind='manual'，活动根跟随 |
| `renameRoot` | 根标签覆盖（NavNode.label），留空回退自动标签 |
| `goBack/goForward` | 注册 `backtrace.goBack` / `backtrace.goForward` 命令 |
| `jumpToCaller` | 注册 `backtrace.jumpToCaller` 命令 — 跳转到节点的 callerUri/callerLine 位置 |
| `moveNodeUp/moveNodeDown` | 注册 `backtrace.moveNodeUp` / `backtrace.moveNodeDown` — 行内 ↑/↓ 按钮兄弟调序（move-node.ts） |

### 数据结构

```ts
interface NavNode {
  uri: string
  line: number
  column: number
  symbolName: string
  contextName: string
  children: NavNode[]
  parent: NavNode | null      // null = 根
  timestamp: number
  callerUri?: string | null
  callerLine?: number | null
  callerColumn?: number | null
  stale?: boolean
  label?: string | null       // 根的自定义标签（重命名后）
  kind?: 'implicit' | 'manual' // 根来源：首跳隐式 / 用户建根或提升
}

interface NavTree {
  roots: readonly NavNode[]   // 只读 getter，数组顺序 = 面板展示顺序
  root: NavNode | null        // 只读 getter：活动根（兼容旧代码）
  activeRootIndex: number
  currentNode: NavNode | null
  maxDepth: number
  isEmpty: boolean
}

interface SerializedTree {    // v2；旧数据缺省 version/roots/activeRootIndex
  version?: 1 | 2
  roots?: number[]            // 根在 nodes 中的索引
  activeRootIndex?: number
  nodes: SerializedNavNode[]
  currentNodeIndex: number | null
  maxDepth: number
}
```

### 核心流程

```
定义 Provider 被调用 → DefinitionInterceptor 记录意图（调用点 + 候选目标）
onDidChangeTextEditorSelection(event.kind === Command)
  → 120ms 防抖确认光标稳定
  → 落点命中意图才记入树（调用点取自意图，精确）
  → 森林为空：本次落点成为隐式根；否则 push 为 currentNode 的子节点
  → Find/Outline/搜索点击无意图，直接丢弃

用户建根（backtrace.createRoot）
  → 光标处取符号上下文（Class#method）→ addRoot → 新根追加、设为活动根 + current
  → 针对 Spring 等框架项目：在 controller/@Scheduled/事件监听器/main 上显式标注起点

用户提升为根（backtrace.promoteNodeToRoot）
  → 节点从 parent.children 摘出 → parent=null → push 进 roots
  → 子树原样保留；caller* 清空（根无调用者）；活动根跟随
  → 这是唯一的结构调整入口（除此之外只有兄弟 ↑/↓ 调序）

文档编辑 → PositionTracker 从所有根出发 BFS，实时换算位移到同文件节点（含调用点）
跳转（goBack/goForward/树点击）→ navigateToNodeResolved 先定位后跳转：
  found → 自愈回写行列（去 stale）→ 跳新位置
  unverifiable（无语言支持等）→ 信旧行号直接跳
  missing → 标 stale + 置灰 + 提示，原地不动（不断链）

backtrace.goBack  → currentNode = currentNode.parent（不删子节点；到根即停）
backtrace.goForward：
  → 0 子节点 → 状态栏提示
  → 1 子节点 → 直接进入
  → >1 子节点 → 取决于 forwardBehavior 设置
切换根：点击底部面板中的任意根/节点 → currentNode 更新 + 活动根跟随

持久化（v2）
  → 先读 backtrace.navTree.v2；没有再读旧 key backtrace.navTree（v1 单根，自动迁移）
  → 只写 v2；旧 key 保留作为降级备份，避免旧版本重存时丢其它根
  → 序列化先放所有根再 BFS 展开，nodes[0] 仍是第一棵树（旧版本可读第一棵）
  → 深度裁剪逐根进行；永不自动删根；裁剪删到 current 时回退父节点
```

---

## 设置项

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `backtrace.maxTreeDepth` | `number` | `50` | **每棵树**的上限深度（根深度 0） |
| `backtrace.persistHistory` | `boolean` | `true` | 是否持久化 |
| `backtrace.forwardBehavior` | `string` | `"notification"` | 多分支前进行为：`notification` / `quickpick` |

## 快捷键

| 命令 | Win/Linux | macOS |
|------|-----------|-------|
| `backtrace.goBack` | Ctrl+Alt+[ | Ctrl+Cmd+[ |
| `backtrace.goForward` | Ctrl+Alt+] | Ctrl+Cmd+] |

> Mac 说明：直译的 `Cmd+Opt+[` 与内置折叠（Fold/Unfold）冲突，
> 故用无冲突的 `Ctrl+Cmd+[` / `]`（`package.json` 的 `mac` 字段覆盖）。
> 建根/重命名/提升为根默认不绑快捷键，可在键盘快捷方式里自行绑定。

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
  - **语义要求**：在保留修改前后依赖语义的前提下，同一语义的修改放在同一 commit，
    不同语义的修改分开 commit（例：数据结构、持久化迁移、命令层、视图层、文档各自独立）。
  - **语言**：commit message 与 CHANGELOG 使用英文（`type: English summary`，
    例：`feat: support multi-root forest`）。
  - 不允许出现未 commit 的修改跨多个 session

---

## Notes

<!-- 快速备注区 -->
