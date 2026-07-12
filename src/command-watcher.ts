/**
 * 命令拦截器。
 *
 * 这个类是扩展的核心引擎：监听用户执行了什么命令，如果命中白名单，
 * 就记录一次导航跳转。
 *
 * 工作流程：
 *   1. 用户按 F12 → onDidExecuteCommand 触发
 *   2. 检查命令 ID 是否在白名单中 → 是
 *   3. 记录"跳转前"的光标位置
 *   4. 等待 120ms（让光标稳定到目标位置）
 *   5. 再次获取光标位置 → 确实变化了 → 记录跳转
 *
 * 为什么需要等 120ms？
 *   onDidExecuteCommand 触发时，光标还停留在"跳转前"的位置。
 *   命令实际执行后光标才会移动，所以需要等一会再获取目标位置。
 *   这叫"防抖"（debounce），防止在光标稳定前错误记录。
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';

/**
 * PendingCapture（"待确认"的跳转信息）。
 *
 * 为什么需要这个临时结构？
 *   命令触发 → 记录"出发位置" → 等 120ms → 再记录"到达位置"。
 *   在这 120ms 内，需要暂存"出发位置"，还要能取消（如果用户又执行了新命令）。
 */
interface PendingCapture {
  fromUri: string;      // 跳转前的文件 URI
  fromLine: number;     // 跳转前的行号
  fromColumn: number;   // 跳转前的列号
  symbolName: string;   // 跳转前光标所在的符号名
  timer: ReturnType<typeof setTimeout>; // setTimeout 返回的计时器句柄，用于取消等待
}

/**
 * CommandWatcher 类。
 *
 * constructor 参数前面的 private 是 TypeScript 的"参数属性"快捷写法：
 *   它会自动创建一个 this.tree 属性并赋值为传入的参数。
 *   等价于：
 *     private tree: NavTree;
 *     constructor(tree: NavTree) { this.tree = tree; }
 */
export class CommandWatcher {
  /**
   * disposable（一次性资源）：
   *   保存 vscode.commands.onDidExecuteCommand() 返回的注册句柄。
   *   为什么保存它？扩展停用时需要调用 .dispose() 来取消监听。
   *   为什么可能为 null？还没调用 activate() 时就是 null。
   */
  private disposable: vscode.Disposable | null = null;

  /**
   * pending（待确认的跳转）：
   *   在 120ms 等待期内暂存的临时信息。
   *   为什么需要它？
   *     - 如果 120ms 内用户又执行了一个命令，需要取消上一次的等待
   *     - 120ms 后，用这里存的"出发位置"和"到达位置"做比对
   */
  private pending: PendingCapture | null = null;

  /**
   * config（当前配置）：
   *   保存用户设置，在事件处理函数中读取。
   *   为什么要存成属性？因为 onDidExecuteCommand 的回调函数
   *   在 activate() 之外执行，需要通过 this.config 访问配置。
   *   "!" 是非空断言，告诉 TypeScript"这个属性在使用前一定会被赋值"。
   */
  private config!: BacktraceConfig;

  constructor(private tree: NavTree) {}

  /**
   * 开始监听。
   *
   * 做了四件事：
   *   1. 保存配置
   *   2. 把命令白名单转成 Set（为什么用 Set？.has() 比 .includes() 快很多）
   *   3. 注册 onDidExecuteCommand 事件监听
   *   4. 把注册句柄加入 context.subscriptions（扩展停用时自动清理）
   */
  activate(config: BacktraceConfig, context: vscode.ExtensionContext): void {
    this.config = config;                                     // 保存配置供事件回调使用

    // 把白名单数组转成 Set。Set 的 .has() 查找时间复杂度 O(1)，
    // 数组的 .includes() 是 O(n)——数组越长就越慢。
    const commandSet = new Set(config.trackedCommands);

    // onDidExecuteCommand: 注册一个监听器（如同 addEventListener）。
    // 它返回一个 Disposable 对象，赋值给 this.disposable。
    //
    // Disposable 是什么？
    //   VSCode 中 "注册一个功能"时几乎都返回 Disposable。
    //   Disposable 只有一个方法 .dispose()，调用它 = "取消注册"。
    //   类比：addEventListener 返回的 removeEventListener 函数。
    //
    // this.disposable 会在回调每次执行时重新赋值吗？
    //   不会。this.disposable 只赋值一次（本行）。
    //   回调 (event) => { ... } 每次命令触发都会执行，
    //   但回调内部不会修改 this.disposable。
    //   this.disposable 代表的是 "这次监听注册" 本身，
    //   不是每次命令执行的结果。
    //
    // event.command: 字符串命令 ID，例如 "editor.action.revealDefinition"。
    // 注意：这是"提议中的 API"，需要在 package.json 中声明 enabledApiProposals。
    this.disposable = vscode.commands.onDidExecuteCommand((event) => {
      // 不在白名单中 → 忽略这次命令。
      // 白名单中只有导航命令（F12/Ctrl+Click 等），其他命令不记录。
      if (!commandSet.has(event.command)) return;

      // activeTextEditor: 当前活跃的编辑器。
      // 如果用户当前没在编辑文件（比如在看设置页面），返回 null。
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      // selection.active: 光标的当前位置（一个 Position 对象，有 line 和 character）。
      const position = editor.selection.active;
      const document = editor.document;

      // getWordRangeAtPosition: 获取光标所在"单词"的起止范围。
      // 比如光标在 "handleClick" 这个单词上，就返回这个词的范围。
      // getText: 获取这个范围的文本内容。
      const wordRange = document.getWordRangeAtPosition(position);
      const word = wordRange ? document.getText(wordRange) : '';

      // VSCode 中行列从 0 开始计数（0 代表第 1 行/第 1 列）。
      // 我们 +1 转成从 1 开始，更符合人的直觉习惯。
      const uri = document.uri.toString();    // "file:///c:/project/app.ts"
      const line = position.line + 1;          // 1-based 行号
      const column = position.character + 1;   // 1-based 列号

      // ── 防抖（debounce）：取消上一次等待 ──
      //
      // 为什么需要防抖？
      //   假设用户快速连按了两次 F12（间隔 < 120ms）：
      //
      //   第一次 F12 触发：
      //     ① 记录出发位置 → ② 设置 120ms 计时器 → ③ this.pending = {...}
      //   第二次 F12 触发（< 120ms 后）：
      //     ① 进入此 if → this.pending 非 null → 取消第一次的计时器
      //     ② 执行 clearTimeout(第一次的 timer) → 第一次跳转作废
      //     ③ 走到下面：重新记录出发位置 → 设置新的 120ms 计时器
      //     ④ this.pending = { ...新的出发位置, timer: 新计时器 }
      //   结果：只处理第二次 F12，第一次被丢弃。
      //
      // 如果不防抖：
      //   两次 F12 会产生两个计时器，120ms 后都会触发 finalizeCapture。
      //   导致一次导航被重复记录两次。
      if (this.pending) {
        // clearTimeout 是 JavaScript 内置函数：取消一个 setTimeout。
        // 传入 timer（setTimeout 的返回值），它就不会被执行了。
        clearTimeout(this.pending.timer);
      }

      // 设置 120ms 延迟。到期后执行 finalizeCapture 确认跳转结果。
      // setTimeout 是 JavaScript 内置函数，在指定毫秒后执行回调。
      const timer = setTimeout(() => {
        this.finalizeCapture(uri, line, column, word);
      }, CURSOR_STABILIZE_DELAY_MS);

      // 暂存本次跳转的"出发位置"信息，供 finalizeCapture 比对。
      this.pending = {
        fromUri: uri,
        fromLine: line,
        fromColumn: column,
        symbolName: word,
        timer,
      };
    });

    // ── 把注册句柄交给 VSCode 管理 ──
    //
    // context.subscriptions 是一个数组，VSCode 扩展停用时自动遍历它，
    // 调用每一项的 .dispose() 方法。这是 VSCode 的标准清理机制。
    //
    // 为什么要推入 subscriptions？
    //   如果用户禁用/卸载扩展，VSCode 需要知道如何停止监听。
    //   不推入 subscriptions 的话，即使 deactivate() 被调用，
    //   但 deactivate() 也可能因为 VSCode 进程崩溃而没有执行。
    //   subscriptions 是"保底清理"——无论如何都会执行 dispose。
    //
    // 为什么加 if (this.disposable) 判断？
    //   onDidExecuteCommand 可能返回 undefined（极少数情况下注册会失败），
    //   但根据 VSCode API 文档，它总是返回 Disposable 对象。
    //   加这个判断是为了 TypeScript 类型安全，也为了防御性编程。
    if (this.disposable) {
      context.subscriptions.push(this.disposable);
    }
  }

  /**
   * 停止监听，清理资源。
   * 在扩展停用或配置变更时调用。
   */
  deactivate(): void {
    // 取消等待中的确认（如果有的话）
    if (this.pending) {
      clearTimeout(this.pending.timer);   // 取消 setTimeout
      this.pending = null;                 // 释放引用
    }
    // "?." 是可选链：如果 disposable 是 null 就不调用 dispose()，不会报错。
    // 等价于：if (this.disposable) { this.disposable.dispose(); }
    this.disposable?.dispose();
    this.disposable = null;
  }

  /**
   * 120ms 后执行的确认函数。
   *
   * 做了三件事：
   *   1. 获取 120ms 后的光标位置（"到达位置"）
   *   2. 比对"出发位置"和"到达位置"——真的跳转了吗？
   *   3. 确实跳转了 → 写入 NavTree
   */
  private finalizeCapture(
    fromUri: string,
    fromLine: number,
    fromColumn: number,
    symbolName: string,
  ): void {
    // 再次获取当前编辑器——120ms 后用户可能已经切换到其他窗口了
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // 获取"跳转后"的光标位置
    const position = editor.selection.active;
    const toUri = editor.document.uri.toString();
    const toLine = position.line + 1;
    const toColumn = position.character + 1;

    // 位置完全没变 → 命令没有实际产生跳转。
    // 可能的原因：命令执行失败了，或者超出了 120ms 用户又取消了跳转。
    // 三个维度（文件、行、列）都一致才判定为"没动"。
    if (toUri === fromUri && toLine === fromLine && toColumn === fromColumn) return;

    // 通过以上过滤 → 这是一次有效的导航跳转，记录到导航树。
    this.tree.addJump(toUri, toLine, toColumn, symbolName);

    // executeCommand('backtrace._treeChanged') 触发内部事件，
    // 通知侧边栏树视图和底部堆栈面板刷新显示。
    vscode.commands.executeCommand('backtrace._treeChanged');
  }
}
