/**
 * 底部树视图面板（底部 Panel → "Backtrace Tree"）。
 *
 * 显示整个导航树的完整结构，每行一个节点，带缩进表示层级。
 * 格式：filename:line  functionPath  ×删除
 *
 * 为什么用 Webview 而不是 TreeView？
 *   需要自定义布局（日志风格的行格式 + 删除按钮），
 *   TreeView 不支持自定义内容。
 *
 * WebviewViewProvider 是 VSCode 提供的接口：
 *   允许在 Panel 区域渲染完全自定义的 HTML。
 *   就像在 VSCode 里嵌了一个"微型浏览器"。
 *   通过 postMessage / onDidReceiveMessage 进行双向通信。
 */

import * as vscode from 'vscode';
import { NavTree } from '../nav-tree';
import { NavNode } from '../nav-node';
import { FILE_COLORS } from '../constants';

export class BacktraceTreePanelProvider implements vscode.WebviewViewProvider {
  // viewType：在 package.json 中声明的视图 ID，必须一致。
  // static 表示不创建实例也能访问：BacktraceTreePanelProvider.viewType
  // readonly 表示初始化后不能修改。
  public static readonly viewType = 'backtraceStack';

  // _view：保存 WebviewView 实例，用于后续更新内容。
  // ? 表示可能为 undefined（面板还没创建时）。
  // 为什么用 private 加下划线 _ 前缀？
  //   这是 TypeScript 约定：_ 开头表示"内部使用，外部不该访问"。
  private _view?: vscode.WebviewView;

  /**
   * constructor 的参数属性快捷写法：
   *   private tree: NavTree
   *   自动创建 this.tree，等价于：
   *     private tree: NavTree;
   *     constructor(tree: NavTree) { this.tree = tree; }
   * 为什么存 tree？因为需要遍历 tree.root 来显示所有节点。
   */
  constructor(private tree: NavTree) {}

  /**
   * resolveWebviewView：WebviewViewProvider 的核心方法。
   * VSCode 在面板首次显示时调用此方法。
   *
   * resolve 在这里是"解析/建立"的意思——建立 webview。
   * 参数由 VSCode 自动传入：
   *   webviewView：实际的 WebviewView 对象
   *   _context：用于传递额外状态
   *   _token：取消令牌，用于长时间操作
   *   _ 开头的参数表示"声明但不使用"（避免 TS 报 unused 错误）
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    // 保存引用，方便后续 update() 调用
    this._view = webviewView;

    // enableScripts: true → 允许 webview 中运行 JavaScript。
    // 注意：VSCode 的 webview 默认禁止任何脚本执行，需要显式开启。
    webviewView.webview.options = { enableScripts: true };

    // 首次渲染内容
    this.update();

    // ── 消息接收器 ──
    // VSCode webview 通信机制：
    //   Webview 端：acquireVsCodeApi().postMessage({ data }) → 发送消息到扩展
    //   扩展端：webview.onDidReceiveMessage(callback) → 接收来自 webview 的消息
    //
    // 类似"两个人隔着墙对话"：
    //   Webview（HTML 端）喊话 → postMessage
    //   扩展（TypeScript 端）听到 → onDidReceiveMessage
    webviewView.webview.onDidReceiveMessage((message) => {
      // ── 跳转命令 ──
      // message.indices 是一个数字数组，如 [0, 1, 2]
      // 表示"从根节点开始，走第 0 个子节点，再走它的第 1 个子节点，再走它的第 2 个子节点"
      if (message.command === 'jumpTo' && message.indices !== undefined) {
        // findNodeAtIndex：按照 indices 路径定位到目标节点
        const node = this.findNodeAtIndex(this.tree.root, message.indices);
        if (node) {
          // 更新当前节点指针（NavTree 内部的状态）
          this.tree.currentNode = node;

          // 构建文件路径 URI
          const uri = vscode.Uri.parse(node.uri);

          // openTextDocument → showTextDocument：打开文件并跳转光标
          // .then() 是 Promise 的语法。第一个函数 = 成功，第二个 = 失败。
          vscode.workspace.openTextDocument(uri).then(
            // 成功：文件存在
            (doc) => vscode.window.showTextDocument(doc, {
              // new vscode.Range(startLine, startCol, endLine, endCol)
              // start 和 end 相同 → 零宽度范围 = 仅定位光标
              selection: new vscode.Range(
                node.line - 1, node.column - 1,  // VSCode 是 0-based，我们存的是 1-based
                node.line - 1, node.column - 1,  // 所以用的时候 -1
              ),
            }),
            // 失败：文件可能已被删除
            () => vscode.window.showErrorMessage(`Backtrace: Could not open ${uri.toString()}`),
          );

          // 触发 UI 刷新：通知侧边栏和底部面板重新渲染
          vscode.commands.executeCommand('backtrace._treeChanged');
        }
      }

      // ── 删除命令 ──
      if (message.command === 'deleteNode' && message.indices !== undefined) {
        const node = this.findNodeAtIndex(this.tree.root, message.indices);
        if (node) {
          // removeNode：从树中删除该节点及其所有子树
          this.tree.removeNode(node);
          // 刷新 UI
          vscode.commands.executeCommand('backtrace._treeChanged');
        }
      }
    });
  }

  /**
   * update：重新渲染面板内容。
   * 外部在树变化时调用此方法刷新显示。
   */
  update(): void {
    if (!this._view) return;
    // .html 属性：替换 webview 的整个 HTML 内容。
    // 每次更新都是"全量替换"——VSCode 的 webview 不支持 DOM diff。
    this._view.webview.html = this.buildHtml();
  }

  /**
   * 递归查找节点：按索引路径定位。
   *
   * 索引路径如 [0, 1] 的含义：
   *   root.children[0] = 第 1 个子节点
   *   root.children[0].children[1] = 第 1 个子节点的第 2 个子节点
   *
   * 为什么用数字索引而不是节点 ID？
   *   Webview 端是 HTML，不能直接传 JavaScript 对象引用。
   *   数字数组可以序列化为 JSON 字符串（data-idx='[0,1]'），
   *   在扩展端 JSON.parse 还原。
   *
   * @param node 起始节点（通常是 root）
   * @param indices 索引路径数组
   * @returns 找到的节点，或 null（路径无效）
   */
  private findNodeAtIndex(node: NavNode | null, indices: number[]): NavNode | null {
    // for...of：遍历数组的每个元素
    let current = node;
    for (const i of indices) {
      // 防御性检查：当前节点不存在，或索引超出子节点数量
      if (!current || i >= current.children.length) return null;
      current = current.children[i]; // 沿着路径往下走一层
    }
    return current; // 走完所有索引后，current 就是目标节点
  }

  /**
   * 根据 URI 字符串计算颜色。
   *
   * 为什么用哈希算法而不是像 TreeDataProvider 那样用 Map？
   *   Map 需要记录每个文件对应的颜色索引，有状态。
   *   哈希算法：相同 URI 始终产生相同颜色，不需要状态。
   *
   * 算法原理（简易哈希——cyclic redundancy style）：
   *   hash = (hash << 5) - hash + charCode
   *   相当于 hash = hash * 31 + charCode（位运算更快）
   *   31 是常用质数——分布均匀，冲突概率低。
   *   Math.abs()：确保结果为正数
   *   % FILE_COLORS.length：映射到调色板范围内
   */
  private getFileColor(uri: string): string {
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
      hash = (hash << 5) - hash + uri.charCodeAt(i);
    }
    return FILE_COLORS[Math.abs(hash) % FILE_COLORS.length];
  }

  /**
   * 从 URI 中提取简短的文件名。
   *
   * .pop() 是 JavaScript 数组方法：删除并返回最后一个元素。
   *   例：['file:', '', 'c:', 'app.ts'].pop() → 'app.ts'
   *
   * || 运算符：返回第一个"真值"（truthy）结果。
   *   先用 / 分割（处理 Unix/URL 路径），
   *   不行再用 \ 分割（处理 Windows 路径），
   *   还不行就用原字符串兜底。
   */
  private shortFileName(uri: string): string {
    return uri.split('/').pop() || uri.split('\\').pop() || uri;
  }

  /**
   * HTML 转义：防止特殊字符破坏页面结构。
   *
   * 如果用户定义了一个函数名为 get<T>Data，不加转义，
   * HTML 中显示 <T> 会被浏览器误认为是标签。
   *
   * 转义规则：& → &amp;  < → &lt;  > → &gt;  " → &quot;  ' → &#039;
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')    // less than（小于号）
      .replace(/>/g, '&gt;')    // greater than（大于号）
      .replace(/"/g, '&quot;')  // 双引号
      .replace(/'/g, '&#039;'); // 单引号
  }

  /**
   * 递归生成节点的 HTML 行。
   *
   * 递归 = 函数调用自身：
   *   1. 先生成当前节点的 <div>
   *   2. 再对每个子节点调用 renderNode（自己调用自己）
   *   3. 子节点再对它的子节点调用 renderNode...
   *   4. 最后把所有 HTML 拼接在一起
   *
   * @param node 当前要渲染的节点
   * @param depth 当前深度（0 = 根节点），用于缩进
   * @param indices 从根到当前节点的索引路径，用于定位
   * @returns 该节点及其所有子节点的 HTML 字符串
   */
  private renderNode(node: NavNode, depth: number, indices: number[]): string {
    const color = this.getFileColor(node.uri);
    const fileName = this.shortFileName(node.uri);
    const display = node.contextName || node.symbolName || '(root)';
    const isCurrent = node === this.tree.currentNode;
    const indent = depth * 20;  // 每层缩进 20 像素
    const idxAttr = JSON.stringify(indices);  // 转成 JSON 字符串存入 HTML

    // 模板字符串：每行是一个 flex 容器，包含：
    //   最左侧 → × 删除按钮（不缩进）
    //   其后 → 缩进占位（按 depth 层级）
    //   其后 → 颜色圆点 + 文件名:行号 + 函数名
    let html = `
      <div class="stack-row ${isCurrent ? 'current' : ''}" data-idx='${idxAttr}'>
        <span class="delete-btn" data-action="delete">&times;</span>
        <span class="indent" style="width:${indent}px"></span>
        <span class="file-color" style="background:${color}"></span>
        <span class="file-loc">${this.escapeHtml(fileName)}:${node.line}</span>
        <span class="func-path">${this.escapeHtml(display)}</span>
        <span class="spacer"></span>
        ${isCurrent ? '<span class="badge">\u2190</span>' : ''}
      </div>`;

    // 递归子节点：for 循环遍历当前节点的每个子节点
    // [...indices, i]：复制当前索引数组并追加 i
    //   例：当前是 [0, 1]，第 3 个子节点的索引 = [0, 1, 2]
    for (let i = 0; i < node.children.length; i++) {
      html += this.renderNode(node.children[i], depth + 1, [...indices, i]);
    }

    return html;
  }

  /**
   * buildHtml：组装完整的 HTML 页面。
   *
   * 返回包含样式、内容和 JavaScript 的完整 HTML 字符串。
   * 每次 update() 都会重新生成全部 HTML，替换整个 webview 内容。
   */
  private buildHtml(): string {
    // 如果树为空，显示"暂无记录"；否则递归渲染所有节点
    const treeHtml = this.tree.root ? this.renderNode(this.tree.root, 0, []) : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<style>
/* VSCode 自定义 CSS 属性（var(--vscode-...)）：
   这些变量由 VSCode 动态注入到 webview 中，值随当前主题变化。
   使用这些变量可以保证我们的 webview 颜色和 VSCode 主题一致。 */

body {
  font-family: var(--vscode-font-family);
  font-size: 13px;
  padding: 4px 0;
  margin: 0;
}

/* 每条导航记录的行 */
.stack-row {
  display: flex;         /* 弹性布局：子元素横向排列 */
  align-items: center;   /* 垂直居中 */
  gap: 5px;              /* 子元素间距 */
  padding: 3px 0;        /* 上下 3px，左右 0（× 按钮紧贴左侧） */
  cursor: pointer;       /* 鼠标变为手型，提示可点击 */
  border-radius: 2px;
}

.stack-row:hover {
  background: var(--vscode-list-hoverBackground); /* 悬停高亮 */
}

.stack-row.current {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

/* 文件颜色小圆点 */
.file-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;  /* 圆形 */
  flex-shrink: 0;      /* 不被压缩 */
}

/* 文件名:行号（配色方案颜色） */
.file-loc {
  color: var(--vscode-textPreformat-foreground);
  white-space: nowrap;  /* 不换行 */
}

/* 函数路径 */
.func-path {
  font-weight: 500;      /* 中等粗细 */
  white-space: nowrap;
}

.spacer {
  flex: 1; /* 占据所有剩余空间，把 ← 推到右边 */
}

.badge {
  font-weight: bold;
  font-size: 12px;
}

/* × 删除按钮：默认隐藏，hover 时显示 */
.delete-btn {
  visibility: hidden;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.6;
  flex-shrink: 0;  /* 不被压缩 */
  min-width: 14px; /* 保证可点击区域 */
  text-align: center;
}
.delete-btn:hover {
  opacity: 1;
}
.stack-row:hover .delete-btn {
  visibility: visible;
}

/* 缩进占位：根据 depth 层级产生树状缩进效果 */
.indent {
  flex-shrink: 0;
}

/* 空树提示 */
.empty {
  color: var(--vscode-disabledForeground);
  padding: 16px;
  text-align: center;
}
</style>
</head>
<body>
${treeHtml || '<div class="empty">No navigation history</div>'}

<script>
// ── Webview JavaScript — 在"隔离浏览器"中运行 ──
// 这个脚本在 VSCode 的 webview 沙箱中执行。
// 它不能访问 Node.js API，也不在真实浏览器中。
// 通过 acquireVsCodeApi() 获得有限的通信能力。

(function() {
  "use strict";  // 严格模式

  // acquireVsCodeApi()：获取 VSCode 提供的 API 对象。
  // 这个函数由 VSCode 注入到 webview 的全局作用域中。
  // API 对象只有一个方法：postMessage()。
  const vscode = acquireVsCodeApi();

  // 遍历所有 .stack-row 元素
  document.querySelectorAll('.stack-row').forEach(row => {
    // dataset.idx：读取 HTML 的 data-idx 属性。
    // HTML：data-idx='[0,1]'
    // JS：row.dataset.idx → "[0,1]"
    // JSON.parse → [0, 1]
    const idx = JSON.parse(row.dataset.idx);

    // 点击整行 → 跳转（除非点的是 × 按钮）
    row.addEventListener('click', (e) => {
      // classList.contains：判断点击目标是否包含某个 CSS 类名
      if (e.target.classList.contains('delete-btn')) return;  // × 按钮不触发跳转
      // postMessage：发送消息给扩展（TypeScript 端）
      vscode.postMessage({ command: 'jumpTo', indices: idx });
    });

    // × 删除按钮的独立点击事件
    const delBtn = row.querySelector('.delete-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();  // 阻止事件冒泡：避免触发上层的 row.click
        vscode.postMessage({ command: 'deleteNode', indices: idx });
      });
    }
  });
})();
</script>
</body>
</html>`;
  }
}
